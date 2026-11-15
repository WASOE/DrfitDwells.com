// A deliberately limited fixture, not an implementation of DirectAdmin.
// Real generator behavior must be verified separately on the hosting system.
export function renderCustom(source, isSubdomain, initialRoot) {
  let docroot = initialRoot;
  const active = [true];
  const conditions = [];
  const output = [];
  for (const line of source.split('\n')) {
    if (/^\|\*if !SUB\|$/.test(line)) {
      conditions.push({ condition: !isSubdomain, hasElse: false });
      active.push(active.at(-1) && !isSubdomain);
    } else if (/^\|\*if SUB\|$/.test(line)) {
      conditions.push({ condition: isSubdomain, hasElse: false });
      active.push(active.at(-1) && isSubdomain);
    } else if (/^\|\*else\|$/.test(line)) {
      const current = conditions.at(-1);
      if (!current || current.hasElse) throw new Error('Unmatched DirectAdmin else');
      current.hasElse = true;
      active[active.length - 1] = active.at(-2) && !current.condition;
    } else if (/^\|\*endif\|$/.test(line)) {
      if (active.length === 1) throw new Error('Unmatched DirectAdmin endif');
      active.pop();
      conditions.pop();
    } else if (/^\|\?DOCROOT=.*\|$/.test(line)) {
      if (active.at(-1)) docroot = line.slice(10, -1);
    } else if (line.startsWith('|*') || line.startsWith('|?')) {
      throw new Error(`Unsupported fixture token: ${line}`);
    } else if (active.at(-1)) {
      output.push(line);
    }
  }
  if (active.length !== 1) throw new Error('Unclosed DirectAdmin conditional');
  return { custom: output.join('\n').replace(/\n+$/, ''), docroot };
}

export function renderAccountConfig(source, { root, testRoot, unrelated }) {
  function block(port, subdomain) {
    const { custom, docroot } = renderCustom(source, subdomain, subdomain ? testRoot : root);
    const host = subdomain ? 'test.driftdwells.com' : 'www.driftdwells.com';
    const aliases = subdomain ? '' : '\tServerAlias www.driftdwells.com driftdwells.com\n';
    const tls = port === 443 ? '\tSSLEngine on\n\tSSLCertificateFile /fixture/cert\n\tSSLCertificateKeyFile /fixture/key\n' : '';
    const cgiRoot = port === 443 && !subdomain ? root : docroot;
    return `<VirtualHost 127.0.0.1:${port}>
${custom}
${tls}\tServerName ${host}
${aliases}\tDocumentRoot "${docroot}"
\tScriptAlias /cgi-bin/ "${cgiRoot}/cgi-bin/"
\t<Directory "${docroot}">
\t</Directory>
</VirtualHost>`;
  }
  return `# account fixture\n${[block(80, false), block(443, false), block(80, true), block(443, true), unrelated].join('\n')}\n`;
}
