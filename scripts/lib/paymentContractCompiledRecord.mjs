/**
 * Parse the compiled checkout payment-contract record from production JavaScript.
 *
 * Success requires one object literal returned from code, with the contract
 * version and the three capability flags together. Strings and comments do
 * not count, even when they contain the same tokens.
 */

export const EXPECTED_PAYMENT_CONTRACT_VERSION = 'checkout-payment-v2-finalize-1';

const RECORD_KEYS = [
  'paymentContractVersion',
  'checkoutSessionV2',
  'finalizeIntentPersist',
  'finalizeIntentRequiredForPi',
  'frontendRelease'
];

function parseBooleanToken(token) {
  if (token === 'true' || token === '!0') return true;
  if (token === 'false' || token === '!1') return false;
  return null;
}

function parseReleaseToken(token) {
  if (token === 'null') return null;
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    try {
      const value = JSON.parse(token);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseRecordObject(body) {
  const pattern = new RegExp(
    '^\\{\\s*"?paymentContractVersion"?\\s*:\\s*"([^"\\\\]*)"\\s*,\\s*' +
      '"?checkoutSessionV2"?\\s*:\\s*(!0|!1|true|false)\\s*,\\s*' +
      '"?finalizeIntentPersist"?\\s*:\\s*(!0|!1|true|false)\\s*,\\s*' +
      '"?finalizeIntentRequiredForPi"?\\s*:\\s*(!0|!1|true|false)\\s*,\\s*' +
      '"?frontendRelease"?\\s*:\\s*(null|"(?:[^"\\\\]*)")\\s*\\}$'
  );
  const match = pattern.exec(body);
  if (!match) return null;
  const checkoutSessionV2 = parseBooleanToken(match[2]);
  const finalizeIntentPersist = parseBooleanToken(match[3]);
  const finalizeIntentRequiredForPi = parseBooleanToken(match[4]);
  if (
    checkoutSessionV2 === null ||
    finalizeIntentPersist === null ||
    finalizeIntentRequiredForPi === null
  ) {
    return null;
  }
  return {
    paymentContractVersion: match[1],
    checkoutSessionV2,
    finalizeIntentPersist,
    finalizeIntentRequiredForPi,
    frontendRelease: parseReleaseToken(match[5])
  };
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function canStartRegex(source, slashIndex) {
  let j = slashIndex - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  if (j < 0) return true;
  const ch = source[j];
  if ('(,=:[!&|?{};+-~^'.includes(ch)) return true;
  const word = source.slice(Math.max(0, j - 5), j + 1);
  return /(?:^|[^A-Za-z0-9_$])(return|typeof|else|void|case|delete|throw|await|of|in)$/.test(
    ` ${word}`
  );
}

function readCompiledFunctionRecord(source, functionIndex) {
  let j = functionIndex + 'function'.length;
  while (j < source.length && /\s/.test(source[j])) j += 1;
  if (/[A-Za-z_$]/.test(source[j] || '')) {
    j += 1;
    while (j < source.length && /[\w$]/.test(source[j])) j += 1;
  }
  while (j < source.length && /\s/.test(source[j])) j += 1;
  if (source[j] !== '(' || source[j + 1] !== ')') return null;
  j += 2;
  while (j < source.length && /\s/.test(source[j])) j += 1;
  if (source[j] !== '{') return null;
  j += 1;
  while (j < source.length && /\s/.test(source[j])) j += 1;
  if (!source.startsWith('return', j)) return null;
  const beforeReturn = j === 0 ? '' : source[j - 1];
  if (beforeReturn && /[\w$]/.test(beforeReturn)) return null;
  j += 'return'.length;
  while (j < source.length && /\s/.test(source[j])) j += 1;
  if (source[j] !== '{') return null;
  const end = findMatchingBrace(source, j);
  if (end < 0) return null;
  return {
    record: parseRecordObject(source.slice(j, end + 1)),
    next: end + 1
  };
}

function sameRecord(left, right) {
  return RECORD_KEYS.every((key) => left[key] === right[key]);
}

/**
 * Extract compiled records from JavaScript source.
 * Matches are ignored inside strings and comments.
 */
export function extractCompiledPaymentContracts(source) {
  const text = String(source || '');
  const records = [];
  let i = 0;
  let state = 'code';
  let stateQuote = '';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === 'line-comment') {
      if (ch === '\n') state = 'code';
      i += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'string') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === stateQuote) {
        state = 'code';
      }
      i += 1;
      continue;
    }
    if (state === 'regex') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '[') {
        state = 'regex-class';
      }
      if (ch === '/') state = 'code';
      i += 1;
      continue;
    }
    if (state === 'regex-class') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === ']') state = 'regex';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      state = 'line-comment';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block-comment';
      i += 2;
      continue;
    }
    if (ch === '/' && next !== '/' && next !== '*' && canStartRegex(text, i)) {
      state = 'regex';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      state = 'string';
      stateQuote = ch;
      i += 1;
      continue;
    }
    if (text.startsWith('function', i)) {
      const before = i === 0 ? '' : text[i - 1];
      if (!before || !/[\w$]/.test(before)) {
        const found = readCompiledFunctionRecord(text, i);
        if (found) {
          if (found.record) records.push(found.record);
          i = found.next;
          continue;
        }
      }
    }
    i += 1;
  }
  return records;
}

export function compiledRecordsAgree(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const [first] = records;
  for (const record of records.slice(1)) {
    if (!sameRecord(first, record)) return null;
  }
  return first;
}
