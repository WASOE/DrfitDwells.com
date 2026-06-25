'use strict';

const net = require('net');
const tls = require('tls');
const nodemailer = require('nodemailer');
const emailService = require('../emailService');
const {
  openManualReviewItem,
  resolveSmtpHealthManualReviews
} = require('../ops/ingestion/manualReviewService');

const SMTP_TRANSPORT_UNHEALTHY = 'smtp_transport_unhealthy';
const SMTP_CERT_EXPIRING = 'smtp_cert_expiring';
const SMTP_HEALTH_ENTITY_TYPE = 'SmtpHealth';
const SMTP_HEALTH_SOURCE = 'smtp_health_service';

const DEFAULT_CERT_WARNING_DAYS = 14;
const DEFAULT_SOCKET_TIMEOUT_MS = 15000;

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
}

function getCertExpiryWarningDays() {
  const parsed = Number.parseInt(process.env.SMTP_CERT_EXPIRY_WARNING_DAYS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CERT_WARNING_DAYS;
}

function buildSmtpTransportConfig() {
  if (typeof emailService.buildSmtpTransportConfig === 'function') {
    return emailService.buildSmtpTransportConfig();
  }
  return null;
}

function getSafeSmtpDiagnostics(transportWrap = null) {
  const wrap = transportWrap || buildSmtpTransportConfig();
  const tlsServername = (process.env.SMTP_TLS_SERVERNAME || '').trim() || null;

  if (!wrap) {
    return {
      configured: false,
      host: null,
      port: null,
      secure: null,
      tlsServername,
      source: null,
      hasAuth: false
    };
  }

  const { config, source } = wrap;
  if (config.url) {
    try {
      const url = new URL(config.url);
      const port = url.port
        ? Number.parseInt(url.port, 10)
        : url.protocol === 'smtps:'
          ? 465
          : 587;
      return {
        configured: true,
        host: url.hostname,
        port: Number.isFinite(port) ? port : 587,
        secure: url.protocol === 'smtps:',
        tlsServername: config.tls?.servername || tlsServername,
        source,
        hasAuth: Boolean(url.username)
      };
    } catch {
      return {
        configured: true,
        host: null,
        port: null,
        secure: null,
        tlsServername: config.tls?.servername || tlsServername,
        source,
        hasAuth: false,
        parseError: true
      };
    }
  }

  const port = Number.isFinite(config.port) ? config.port : 587;
  return {
    configured: true,
    host: config.host || null,
    port,
    secure: Boolean(config.secure),
    tlsServername: config.tls?.servername || tlsServername,
    source,
    hasAuth: Boolean(config.auth?.user || config.auth?.pass)
  };
}

function smtpEntityId(diagnostics) {
  if (diagnostics?.host && diagnostics?.port) {
    return `${diagnostics.host}:${diagnostics.port}`;
  }
  return 'unconfigured';
}

function redactDiagnosticsForLog(diagnostics) {
  const safe = getSafeSmtpDiagnostics();
  return {
    ...safe,
    ...(diagnostics && typeof diagnostics === 'object' ? diagnostics : {})
  };
}

function readSmtpResponse(socket, timeoutMs = DEFAULT_SOCKET_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP response timeout'));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter((line) => line.length > 0);
      const last = lines[lines.length - 1];
      if (last && last.length >= 4 && last[3] === ' ') {
        cleanup();
        resolve(buffer);
      }
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
    };

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function fetchSmtpPeerCertificate({ host, port, secure, servername }) {
  const sni = servername || host;
  if (!host || !port) {
    throw new Error('SMTP host and port are required for certificate inspection');
  }

  if (secure) {
    return await new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host, port, servername: sni, rejectUnauthorized: true },
        () => {
          try {
            const cert = socket.getPeerCertificate();
            socket.end();
            resolve(cert);
          } catch (err) {
            socket.destroy();
            reject(err);
          }
        }
      );
      socket.setTimeout(DEFAULT_SOCKET_TIMEOUT_MS, () => {
        socket.destroy(new Error('TLS connection timeout'));
      });
      socket.on('error', reject);
    });
  }

  const socket = net.connect({ host, port });
  socket.setTimeout(DEFAULT_SOCKET_TIMEOUT_MS);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('SMTP connection timeout')));
  });

  try {
    await readSmtpResponse(socket);
    socket.write('EHLO smtp-health.local\r\n');
    const ehloResponse = await readSmtpResponse(socket);
    if (!/STARTTLS/i.test(ehloResponse)) {
      throw new Error('SMTP server does not advertise STARTTLS');
    }
    socket.write('STARTTLS\r\n');
    const startTlsResponse = await readSmtpResponse(socket);
    if (!/^220/m.test(startTlsResponse)) {
      throw new Error(`STARTTLS rejected: ${String(startTlsResponse).split('\n')[0]}`);
    }

    const tlsSocket = await new Promise((resolve, reject) => {
      const wrapped = tls.connect({ socket, servername: sni, rejectUnauthorized: true }, () => resolve(wrapped));
      wrapped.setTimeout(DEFAULT_SOCKET_TIMEOUT_MS, () => {
        wrapped.destroy(new Error('STARTTLS handshake timeout'));
      });
      wrapped.on('error', reject);
    });

    try {
      return tlsSocket.getPeerCertificate();
    } finally {
      tlsSocket.end();
    }
  } finally {
    socket.destroy();
  }
}

function parseCertificateValidTo(cert) {
  if (!cert?.valid_to) return null;
  const date = new Date(cert.valid_to);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeDaysRemaining(validTo) {
  if (!validTo) return null;
  const ms = validTo.getTime() - Date.now();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

async function verifySmtpTransport({ transporter = null } = {}) {
  const transportWrap = buildSmtpTransportConfig();
  const diagnostics = getSafeSmtpDiagnostics(transportWrap);

  if (!transportWrap) {
    return {
      ok: false,
      error: 'SMTP transport not configured',
      diagnostics
    };
  }

  let verifyTransporter = transporter;
  let shouldClose = false;

  if (!verifyTransporter) {
    if (emailService.initPromise) {
      await emailService.initPromise;
    }
    if (emailService.isConfigured && emailService.transporter) {
      verifyTransporter = emailService.transporter;
    } else {
      verifyTransporter = nodemailer.createTransport(transportWrap.config);
      shouldClose = true;
    }
  }

  try {
    await verifyTransporter.verify();
    return { ok: true, diagnostics };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'SMTP verify failed',
      diagnostics
    };
  } finally {
    if (shouldClose && typeof verifyTransporter.close === 'function') {
      verifyTransporter.close();
    }
  }
}

async function checkSmtpCertificateExpiry({ fetchCertificate = fetchSmtpPeerCertificate } = {}) {
  const diagnostics = getSafeSmtpDiagnostics();
  const warningDays = getCertExpiryWarningDays();

  if (!diagnostics.configured || !diagnostics.host || !diagnostics.port) {
    return {
      readOk: false,
      ok: false,
      expiring: false,
      diagnostics,
      warningDays,
      error: 'SMTP not configured for certificate inspection'
    };
  }

  try {
    const cert = await fetchCertificate({
      host: diagnostics.host,
      port: diagnostics.port,
      secure: diagnostics.secure,
      servername: diagnostics.tlsServername || diagnostics.host
    });
    const validTo = parseCertificateValidTo(cert);
    const daysRemaining = computeDaysRemaining(validTo);
    const expiring = daysRemaining != null && daysRemaining <= warningDays;

    return {
      readOk: true,
      ok: !expiring,
      expiring,
      diagnostics,
      warningDays,
      validTo: validTo ? validTo.toISOString() : null,
      daysRemaining
    };
  } catch (err) {
    return {
      readOk: false,
      ok: false,
      expiring: false,
      diagnostics,
      warningDays,
      error: err?.message || 'Certificate inspection failed'
    };
  }
}

async function openSmtpHealthManualReview({
  category,
  severity,
  entityId,
  title,
  details,
  evidence
}) {
  return openManualReviewItem({
    category,
    severity,
    entityType: SMTP_HEALTH_ENTITY_TYPE,
    entityId,
    title,
    details,
    provenance: { source: SMTP_HEALTH_SOURCE },
    evidence
  });
}

async function runSmtpHealthCheck(deps = {}) {
  const verifyFn = deps.verifyTransport || verifySmtpTransport;
  const certFn = deps.checkCertificate || checkSmtpCertificateExpiry;

  const verifyResult = await verifyFn(deps.verifyOptions || {});
  const diagnostics = verifyResult.diagnostics || getSafeSmtpDiagnostics();
  const entityId = smtpEntityId(diagnostics);

  if (verifyResult.ok) {
    await resolveSmtpHealthManualReviews({
      category: SMTP_TRANSPORT_UNHEALTHY,
      entityId,
      note: 'Auto-resolved: SMTP transport verification succeeded.'
    });
  } else {
    await openSmtpHealthManualReview({
      category: SMTP_TRANSPORT_UNHEALTHY,
      severity: 'critical',
      entityId,
      title: 'SMTP transport unhealthy',
      details: verifyResult.error || 'SMTP transport verification failed',
      evidence: {
        host: diagnostics.host,
        port: diagnostics.port,
        secure: diagnostics.secure,
        tlsServername: diagnostics.tlsServername,
        error: verifyResult.error || 'SMTP transport verification failed'
      }
    });
  }

  let certResult = {
    readOk: false,
    ok: true,
    expiring: false,
    validTo: null,
    daysRemaining: null
  };

  if (diagnostics.configured) {
    certResult = await certFn(deps.certOptions || {});
    if (certResult.readOk && certResult.expiring) {
      await openSmtpHealthManualReview({
        category: SMTP_CERT_EXPIRING,
        severity: 'high',
        entityId,
        title: 'SMTP certificate expiring',
        details: `SMTP TLS certificate expires in ${certResult.daysRemaining} day(s)`,
        evidence: {
          host: diagnostics.host,
          port: diagnostics.port,
          tlsServername: diagnostics.tlsServername,
          validTo: certResult.validTo,
          daysRemaining: certResult.daysRemaining,
          warningDays: certResult.warningDays
        }
      });
    } else if (certResult.readOk && !certResult.expiring) {
      await resolveSmtpHealthManualReviews({
        category: SMTP_CERT_EXPIRING,
        entityId,
        note: 'Auto-resolved: SMTP certificate is outside the expiry warning window.'
      });
    }
  }

  const lastStatus = !verifyResult.ok
    ? 'unhealthy'
    : certResult.readOk && certResult.expiring
      ? 'cert_expiring'
      : 'healthy';

  return {
    lastStatus,
    lastError: verifyResult.ok ? certResult.error || null : verifyResult.error || null,
    diagnostics: redactDiagnosticsForLog(diagnostics),
    verify: {
      ok: verifyResult.ok,
      error: verifyResult.error || null
    },
    certificate: {
      readOk: certResult.readOk,
      expiring: Boolean(certResult.expiring),
      validTo: certResult.validTo || null,
      daysRemaining: certResult.daysRemaining ?? null,
      warningDays: certResult.warningDays ?? getCertExpiryWarningDays(),
      error: certResult.error || null
    }
  };
}

module.exports = {
  SMTP_TRANSPORT_UNHEALTHY,
  SMTP_CERT_EXPIRING,
  SMTP_HEALTH_ENTITY_TYPE,
  getCertExpiryWarningDays,
  getSafeSmtpDiagnostics,
  verifySmtpTransport,
  checkSmtpCertificateExpiry,
  fetchSmtpPeerCertificate,
  runSmtpHealthCheck
};
