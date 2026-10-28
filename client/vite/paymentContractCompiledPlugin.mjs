/**
 * Production-build plugin.
 *
 * After Vite substitutes import.meta.env, read the substituted flag modules
 * and replace the checkout contract module with one object literal. The
 * release verifier parses that object from the compiled JavaScript. It does
 * not trust a sidecar file or stray copies of the contract strings.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBooleanFlag } from '../../shared/env/parseBooleanFlag.js';
import { PRODUCTION_PAYMENT_CONTRACT_VERSION } from '../../shared/payments/productionPaymentContract.js';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stampFile = path.join(clientRoot, 'src/utils/paymentContractCompiled.js');
const v2File = path.join(clientRoot, 'src/utils/checkoutSessionV2Flags.js');
const finalizeFile = path.join(clientRoot, 'src/utils/finalizeIntentFlags.js');

function normalize(id) {
  return String(id || '').split('?')[0];
}

export function evaluateFlagArgument(expression) {
  const expr = String(expression || '').trim();
  if (expr === 'undefined' || expr === 'void 0') return { ok: true, value: false };
  const quoted = expr.match(/^(['"])([\s\S]*)\1$/);
  if (!quoted) {
    return { ok: false, reason: `unrecognized compiled flag expression: ${expr.slice(0, 80)}` };
  }
  return { ok: true, value: parseBooleanFlag(quoted[2]) };
}

export function extractFlagCalls(source) {
  if (String(source || '').includes('import.meta.env.VITE_')) {
    return { ok: false, reason: 'flag module was not substituted by Vite' };
  }
  const values = [];
  const re = /parseBooleanFlag\(([^()]*)\)/g;
  let match = re.exec(source);
  while (match) {
    const evaluated = evaluateFlagArgument(match[1]);
    if (!evaluated.ok) return evaluated;
    values.push(evaluated.value);
    match = re.exec(source);
  }
  if (values.length === 0) {
    return { ok: false, reason: 'compiled flag module has no parseBooleanFlag call' };
  }
  return { ok: true, values };
}

export function extractFrontendRelease(source) {
  const text = String(source || '');
  if (text.includes('import.meta.env')) {
    return { ok: false, reason: 'frontend release was not substituted by Vite' };
  }
  const start = text.indexOf('frontendRelease');
  if (start < 0) return { ok: false, reason: 'compiled contract module has no frontendRelease' };
  const slice = text.slice(start, start + 500);
  const strings = [...slice.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((item) => {
    try {
      return JSON.parse(`"${item[1]}"`);
    } catch {
      return '';
    }
  });
  const value = strings.find((item) => typeof item === 'string' && item.trim()) || null;
  return { ok: true, value };
}

function releaseOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

export function renderCompiledContractModule(record) {
  return `export function readPaymentContractCompiled(){return ${JSON.stringify(record)};}\n`;
}

export function paymentContractCompiledPlugin() {
  const captured = {
    checkoutSessionV2: null,
    finalizeIntentPersist: null,
    finalizeIntentRequiredForPi: null
  };

  return {
    name: 'payment-contract-compiled',
    apply: 'build',
    enforce: 'post',
    async transform(code, id) {
      const file = normalize(id);
      if (file === v2File) {
        const extracted = extractFlagCalls(code);
        if (!extracted.ok || extracted.values.length !== 1) {
          this.error(extracted.reason || 'Checkout V2 flag module did not compile to one flag.');
        }
        captured.checkoutSessionV2 = extracted.values[0];
        return null;
      }
      if (file === finalizeFile) {
        const extracted = extractFlagCalls(code);
        if (!extracted.ok || extracted.values.length !== 2) {
          this.error(
            extracted.reason || 'Finalize flag module did not compile to persist and required flags.'
          );
        }
        captured.finalizeIntentPersist = extracted.values[0];
        captured.finalizeIntentRequiredForPi = extracted.values[1];
        return null;
      }
      if (file !== stampFile) return null;

      const release = extractFrontendRelease(code);
      if (!release.ok) this.error(release.reason);
      await this.load({ id: v2File });
      await this.load({ id: finalizeFile });
      if (
        captured.checkoutSessionV2 === null ||
        captured.finalizeIntentPersist === null ||
        captured.finalizeIntentRequiredForPi === null
      ) {
        this.error('Compiled checkout flags were not captured from the flag modules.');
      }
      const record = {
        paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION,
        checkoutSessionV2: captured.checkoutSessionV2 === true,
        finalizeIntentPersist: captured.finalizeIntentPersist === true,
        finalizeIntentRequiredForPi: captured.finalizeIntentRequiredForPi === true,
        frontendRelease: releaseOrNull(release.value)
      };
      return { code: renderCompiledContractModule(record), map: null };
    }
  };
}
