function normalizeHost(rawHost) {
  return String(rawHost || '').trim().toLowerCase().replace(/\.+$/, '');
}

function isHttpProtocol(protocol) {
  return protocol === 'http:' || protocol === 'https:';
}

function isSafeGoogleMapsUrl(value) {
  if (!value) return true;
  const v = String(value).trim();
  if (!v) return true;

  let parsed;
  try {
    parsed = new URL(v);
  } catch (_err) {
    return false;
  }

  if (!isHttpProtocol(parsed.protocol)) return false;

  const host = normalizeHost(parsed.hostname);
  const path = String(parsed.pathname || '');

  if ((host === 'google.com' || host === 'www.google.com') && path.startsWith('/maps')) {
    return true;
  }

  if (host === 'maps.google.com') {
    return true;
  }

  // Short/share domains should remain HTTPS-only.
  if (parsed.protocol !== 'https:') {
    return false;
  }

  if (host === 'maps.app.goo.gl') {
    return true;
  }

  if (host === 'goo.gl' && path.startsWith('/maps')) {
    return true;
  }

  if (host === 'share.google') {
    return true;
  }

  return false;
}

module.exports = {
  isSafeGoogleMapsUrl
};
