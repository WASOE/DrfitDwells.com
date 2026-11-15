import { renderCustom } from './renderer.mjs';

// Isolated Apache fixture only; this deliberately does not emulate all DA syntax.
export function renderAlmaFixture(source, { original, testSite, backend }) {
  const siteBlock = port => {
    const { custom, docroot } = renderCustom(source, false, original);
    const cgiRoot = port === 443 ? original : docroot;
    return `<VirtualHost *:${port}>
${custom}
  ServerName www.driftdwells.com
  ServerAlias www.driftdwells.com driftdwells.com
  DocumentRoot "${docroot}"
  ScriptAlias /cgi-bin/ "${cgiRoot}/cgi-bin/"
  <Directory "${docroot}">
    Options -Indexes
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>`;
  };
  const testBlock = port => {
    const { custom, docroot } = renderCustom(source, true, testSite);
    return `<VirtualHost *:${port}>
${custom}
  ServerName test.driftdwells.com
  DocumentRoot "${docroot}"
  <Directory "${docroot}">
    Require all granted
  </Directory>
</VirtualHost>`;
  };
  return `${siteBlock(80)}
${siteBlock(443)}
${testBlock(80)}
${testBlock(443)}
<VirtualHost *:8081>
  ServerName backend.local
  DocumentRoot "${backend}"
  <Directory "${backend}">
    Require all granted
  </Directory>
</VirtualHost>`;
}
