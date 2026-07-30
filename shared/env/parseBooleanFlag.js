/**
 * Single boolean env-flag parser for client, server, and release verifiers.
 *
 * Accepted truthy: 1 | true | on | yes (case-insensitive; optional whitespace)
 * Accepted falsy:  0 | false | off | no | '' | null | undefined | non-string
 *
 * Unknown non-empty strings are falsy (fail closed) unless parseBooleanFlagWithDefault
 * is used with an explicit default.
 */

export function parseBooleanFlag(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'on' ||
    normalized === 'yes'
  );
}

export function parseBooleanFlagWithDefault(value, defaultValue = false) {
  if (value == null || value === '') return Boolean(defaultValue);
  if (typeof value !== 'string') return Boolean(defaultValue);
  const normalized = value.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'on' ||
    normalized === 'yes'
  ) {
    return true;
  }
  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'off' ||
    normalized === 'no'
  ) {
    return false;
  }
  return Boolean(defaultValue);
}
