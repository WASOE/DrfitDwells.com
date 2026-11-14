/**
 * Produces a proposed config in memory only. Applying it requires a separately
 * verified site-scoped host transition and must not edit the live file.
 */
export function prepareSiteVhostConfig(source, { originalRoot, releasePointer }) {
  for (const value of [originalRoot, releasePointer]) {
    if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value.includes('..') || value.endsWith('/')) {
      throw new Error('Invalid absolute site path');
    }
  }
  if (originalRoot === releasePointer || releasePointer.startsWith(`${originalRoot}/`)) {
    throw new Error('Release pointer must be separate from the original document root');
  }
  let matches = 0;
  const updated = source.replace(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g, block => {
    const names = [...block.matchAll(/^\s*ServerName\s+(\S+)\s*$/gm)].map(match => match[1]);
    if (!names.includes('www.driftdwells.com')) return block;
    if (names.length !== 1 || !/^\s*ServerAlias\s+www\.driftdwells\.com\s+driftdwells\.com\s*$/m.test(block)) {
      throw new Error('Unexpected Drift & Dwells virtual host identity');
    }
    const documentRoot = `DocumentRoot "${originalRoot}"`;
    const directoryRoot = `<Directory "${originalRoot}">`;
    const legalDirectory = `<Directory "${originalRoot}/legal">`;
    const legalAlias = `Alias /legal/ ${originalRoot}/legal/`;
    if ([documentRoot, directoryRoot, legalDirectory, legalAlias].some(directive => block.split(directive).length !== 2)) {
      throw new Error('Unexpected site document root directives');
    }
    for (const proxy of ['ProxyPass /api ', 'ProxyPass /uploads ']) {
      if (!block.includes(proxy)) throw new Error(`Missing site proxy: ${proxy}`);
    }
    matches++;
    return block.replace(documentRoot, `DocumentRoot "${releasePointer}"`)
      .replace(directoryRoot, `<Directory "${releasePointer}">`)
      .replace(legalDirectory, `<Directory "${releasePointer}/legal">`)
      .replace(legalAlias, `Alias /legal/ ${releasePointer}/legal/`);
  });
  if (matches !== 2) throw new Error(`Expected exactly two site vhosts, found ${matches}`);
  return updated;
}
