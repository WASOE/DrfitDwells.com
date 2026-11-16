export function normalizeCompanyWebsite(value) {
  const input = value.trim();
  if (!input) return '';
  if (/[\s\\]/.test(input) || /^[/?#]/.test(input) ||
      [...input].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error('Invalid website');
  }
  const explicitProtocol = /^[a-z][a-z\d+.-]*:/i.test(input);
  if (explicitProtocol && !/^https?:\/\//i.test(input)) throw new Error('Invalid website protocol');
  const url = new URL(explicitProtocol ? input : `https://${input}`);
  const labels = url.hostname.split('.');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      labels.length < 2 || url.hostname.length > 253 ||
      labels.some(label => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)) ||
      !/^(?:[a-z]{2,63}|xn--[a-z\d-]{2,59})$/i.test(labels.at(-1)) ||
      url.href.length > 500) {
    throw new Error('Invalid website');
  }
  return url.href;
}
