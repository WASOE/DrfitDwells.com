import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSiteVhostConfig } from './vhost-migration.mjs';

const root = '/home/illoc/domains/driftdwells.com/public_html';
const pointer = '/home/illoc/releases/frontend/current';
function vhost(port, host, documentRoot) {
  return `<VirtualHost *:${port}>
ProxyPass /api http://127.0.0.1:5000/api
ProxyPass /uploads http://127.0.0.1:5000/uploads
Alias /legal/ ${root}/legal/
<Directory "${root}/legal">
 Options -Indexes
</Directory>
ServerName ${host}
ServerAlias www.driftdwells.com driftdwells.com
DocumentRoot "${documentRoot}"
<Directory "${documentRoot}">
</Directory>
</VirtualHost>`;
}
const site = [vhost(80, 'www.driftdwells.com', root), vhost(443, 'www.driftdwells.com', root)];
const other = vhost(443, 'test.driftdwells.com', `${root}/test`);

test('changes only the two exact main site vhosts and preserves test site and proxies', () => {
  const result = prepareSiteVhostConfig([...site, other].join('\n'), { originalRoot: root, releasePointer: pointer });
  assert.ok(result.endsWith(other));
  assert.equal((result.match(/DocumentRoot "\/home\/illoc\/releases\/frontend\/current"/g) || []).length, 2);
  assert.equal((result.match(/ProxyPass \/uploads /g) || []).length, 3);
  assert.ok(result.includes(`<Directory "${pointer}/legal">`));
  assert.ok(result.includes(`Alias /legal/ ${pointer}/legal/`));
});

test('refuses ambiguous or incomplete configuration', () => {
  assert.throws(() => prepareSiteVhostConfig(site[0], { originalRoot: root, releasePointer: pointer }), /exactly two/);
  assert.throws(() => prepareSiteVhostConfig(site.join('\n').replace('ProxyPass /api', 'ProxyPass /not-api'), { originalRoot: root, releasePointer: pointer }), /Missing site proxy/);
  assert.throws(() => prepareSiteVhostConfig(site.join('\n'), { originalRoot: root, releasePointer: `${root}/current` }), /separate/);
});
