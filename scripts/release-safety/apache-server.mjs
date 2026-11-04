/**
 * User-space Apache 2.4 with the release .htaccess.
 * Production is Apache/2 (2.4). This uses the local Apache 2.4 modules and
 * the same AllowOverride / rewrite file. It does not proxy to production.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function writeCertificate(dir) {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', key, '-out', cert,
    '-days', '2', '-nodes',
    '-subj', '/CN=driftdwells.com'
  ], { stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error('openssl could not create the local Apache certificate.');
  }
  return { key, cert };
}

function httpdConf({ runDir, docroot, httpPort, httpsPort, key, cert }) {
  return `ServerRoot /etc/apache2
ServerName driftdwells.com
PidFile ${runDir}/apache.pid
ErrorLog ${runDir}/error.log
Mutex file:${runDir}
Listen 127.0.0.1:${httpPort}
Listen 127.0.0.1:${httpsPort}

LoadModule mpm_event_module /usr/lib/apache2/modules/mod_mpm_event.so
LoadModule authn_core_module /usr/lib/apache2/modules/mod_authn_core.so
LoadModule authz_core_module /usr/lib/apache2/modules/mod_authz_core.so
LoadModule authz_host_module /usr/lib/apache2/modules/mod_authz_host.so
LoadModule dir_module /usr/lib/apache2/modules/mod_dir.so
LoadModule mime_module /usr/lib/apache2/modules/mod_mime.so
LoadModule rewrite_module /usr/lib/apache2/modules/mod_rewrite.so
LoadModule alias_module /usr/lib/apache2/modules/mod_alias.so
LoadModule headers_module /usr/lib/apache2/modules/mod_headers.so
LoadModule ssl_module /usr/lib/apache2/modules/mod_ssl.so
LoadModule socache_shmcb_module /usr/lib/apache2/modules/mod_socache_shmcb.so

TypesConfig /etc/mime.types
DirectoryIndex index.html

<VirtualHost 127.0.0.1:${httpPort}>
  ServerName driftdwells.com
  ServerAlias www.driftdwells.com
  DocumentRoot ${docroot}
  <Directory ${docroot}>
    Options FollowSymLinks
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>

<VirtualHost 127.0.0.1:${httpsPort}>
  ServerName driftdwells.com
  ServerAlias www.driftdwells.com
  SSLEngine on
  SSLCertificateFile ${cert}
  SSLCertificateKeyFile ${key}
  DocumentRoot ${docroot}
  <Directory ${docroot}>
    Options FollowSymLinks
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>
`;
}

function curl(args) {
  const result = spawnSync('curl', ['-sS', '-k', '--max-redirs', '0', '-D', '-', ...args], {
    encoding: 'utf8'
  });
  if (result.error) throw result.error;
  const raw = result.stdout || '';
  const splitAt = raw.search(/\r?\n\r?\n/);
  const headerText = splitAt === -1 ? raw : raw.slice(0, splitAt);
  const body = splitAt === -1 ? '' : raw.slice(splitAt).replace(/^\r?\n\r?\n/, '');
  const statusLine = headerText.split(/\r?\n/).find((line) => line.startsWith('HTTP/')) || '';
  const status = Number(statusLine.split(' ')[1] || 0);
  const locationLine = headerText.split(/\r?\n/).find((line) => /^location:/i.test(line));
  const location = locationLine ? locationLine.split(':').slice(1).join(':').trim() : '';
  return { status, location, body, headerText };
}

export function linkReleaseDocroot(distDir, dest, htaccessText) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(distDir)) {
    if (entry === '.htaccess') continue;
    const target = path.join(distDir, entry);
    fs.symlinkSync(target, path.join(dest, entry));
  }
  fs.writeFileSync(path.join(dest, '.htaccess'), htaccessText);
  return dest;
}

export async function withApache(docroot, fn) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-apache-'));
  const httpPort = await freePort();
  const httpsPort = await freePort();
  const { key, cert } = writeCertificate(runDir);
  const conf = path.join(runDir, 'httpd.conf');
  fs.writeFileSync(conf, httpdConf({ runDir, docroot, httpPort, httpsPort, key, cert }));
  const started = spawnSync('apache2', ['-f', conf, '-k', 'start'], { encoding: 'utf8' });
  if (started.status !== 0) {
    const log = fs.existsSync(path.join(runDir, 'error.log'))
      ? fs.readFileSync(path.join(runDir, 'error.log'), 'utf8')
      : '';
    throw new Error(`Apache failed to start.\n${started.stderr || ''}\n${log}`);
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const probe = curl(['--resolve', `driftdwells.com:${httpsPort}:127.0.0.1`, `https://driftdwells.com:${httpsPort}/`]);
      if (probe.status > 0) {
        ready = true;
        break;
      }
      await delay(50);
    }
    if (!ready) throw new Error(`Apache did not accept connections. ${fs.readFileSync(path.join(runDir, 'error.log'), 'utf8')}`);
    return await fn({ httpPort, httpsPort, runDir });
  } finally {
    spawnSync('apache2', ['-f', conf, '-k', 'stop'], { stdio: 'ignore' });
  }
}

function localCurl({ scheme, host, listenPort, requestPath }) {
  const publicPort = scheme === 'https' ? 443 : 80;
  const url = `${scheme}://${host}${requestPath}`;
  return curl([
    '--connect-to', `${host}:${publicPort}:127.0.0.1:${listenPort}`,
    url
  ]);
}

export function requestRelease({ httpPort, httpsPort, scheme, host = 'driftdwells.com', requestPath }) {
  const listenPort = scheme === 'https' ? httpsPort : httpPort;
  const first = localCurl({ scheme, host, listenPort, requestPath });
  const result = {
    status: first.status,
    location: first.location,
    body: first.body,
    finalStatus: first.status,
    finalPath: requestPath.split('?')[0]
  };
  if ((first.status === 301 || first.status === 302) && first.location) {
    const location = new URL(first.location, `${scheme}://${host}${requestPath}`);
    const localHost = location.hostname === 'driftdwells.com' || location.hostname === 'www.driftdwells.com';
    const samePathFamily = location.pathname !== '/' && location.pathname !== requestPath.split('?')[0];
    if (localHost && samePathFamily && location.protocol === `${scheme}:`) {
      const second = localCurl({
        scheme,
        host,
        listenPort,
        requestPath: `${location.pathname}${location.search}`
      });
      result.finalStatus = second.status;
      result.finalPath = location.pathname;
      result.body = second.body;
    }
  }
  return result;
}
