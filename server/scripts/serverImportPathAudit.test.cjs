/**
 * Import/path audit + server startup smoke (no new features).
 * Run: cd server && node --test scripts/serverImportPathAudit.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');

const SERVER_DIR = path.join(__dirname, '..');
const SERVER_JS = path.join(SERVER_DIR, 'server.js');

const REL_REQUIRE_RE = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;

function walkJsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      walkJsFiles(p, acc);
    } else if (ent.isFile() && ent.name.endsWith('.js')) {
      acc.push(p);
    }
  }
  return acc;
}

function resolveLocalSpecifier(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  if (fs.existsSync(`${base}.js`) && fs.statSync(`${base}.js`).isFile()) return `${base}.js`;
  const idx = path.join(base, 'index.js');
  if (fs.existsSync(idx) && fs.statSync(idx).isFile()) return idx;
  return null;
}

function auditRelativeRequiresInTree() {
  const roots = ['middleware', 'routes', 'services', 'models', 'utils', 'config'].map((d) =>
    path.join(SERVER_DIR, d)
  );
  const files = roots.flatMap((r) => walkJsFiles(r, []));
  const failures = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const dir = path.dirname(file);
    let m;
    const re = new RegExp(REL_REQUIRE_RE.source, 'g');
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const resolved = resolveLocalSpecifier(dir, spec);
      if (!resolved) {
        failures.push({ file: path.relative(SERVER_DIR, file), spec });
      }
    }
  }
  return failures;
}

function extractBootstrapRelativeRequiresFromServerJs() {
  const lines = fs.readFileSync(SERVER_JS, 'utf8').split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    if (/^\s*const\s+app\s*=\s*express\s*\(/.test(line)) break;
    const re = new RegExp(REL_REQUIRE_RE.source, 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      const spec = m[1];
      if (!seen.has(spec)) {
        seen.add(spec);
        out.push(spec);
      }
    }
  }
  return out;
}

test('static audit: every relative require() under server resolves to a file', () => {
  const failures = auditRelativeRequiresInTree();
  assert.deepEqual(
    failures,
    [],
    failures.length
      ? `Unresolved relative imports:\n${failures.map((f) => `  ${f.file}: require('${f.spec}')`).join('\n')}`
      : ''
  );
});

test('bootstrap load: server.js pre-app relative requires load without MODULE_NOT_FOUND', () => {
  process.env.NODE_ENV = 'test';
  require('dotenv').config({ path: path.join(SERVER_DIR, '.env') });
  const { validateProductionEnvOrExit } = require(path.join(SERVER_DIR, 'config/validateProductionEnv'));
  validateProductionEnvOrExit();
  const specs = extractBootstrapRelativeRequiresFromServerJs();
  for (const spec of specs) {
    require(path.join(SERVER_DIR, spec));
  }
});

test('server process reaches listen (import + startup smoke)', async () => {
  const port = 31000 + Math.floor(Math.random() * 2000);
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';

  const listenPromise = new Promise((resolve, reject) => {
    const timeoutMs = 45000;
    const killTimer = setTimeout(() => {
      cleanup();
      proc.kill('SIGTERM');
      reject(new Error(`timeout after ${timeoutMs}ms waiting for listen; stderr tail:\n${stderr.slice(-2000)}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(killTimer);
      proc.stdout.removeListener('data', onStdout);
      proc.stderr.removeListener('data', onStderr);
      proc.removeListener('exit', onExit);
    }

    function onStdout(chunk) {
      stdout += chunk.toString();
      if (/running on port|Booking Server running/i.test(stdout)) {
        cleanup();
        resolve();
      }
    }

    function onStderr(chunk) {
      stderr += chunk.toString();
      if (/Cannot find module/i.test(stderr)) {
        cleanup();
        proc.kill('SIGKILL');
        reject(new Error(`MODULE_NOT_FOUND before listen:\n${stderr.slice(-4000)}`));
      }
    }

    function onExit(code, signal) {
      cleanup();
      reject(
        new Error(
          `server exited before listen (code=${code} signal=${signal})\nstdout:\n${stdout.slice(-2000)}\nstderr:\n${stderr.slice(-4000)}`
        )
      );
    }

    proc.stdout.on('data', onStdout);
    proc.stderr.on('data', onStderr);
    proc.once('exit', onExit);
  });

  try {
    await listenPromise;
  } finally {
    proc.kill('SIGTERM');
    try {
      await Promise.race([once(proc, 'exit'), new Promise((r) => setTimeout(r, 8000))]);
    } catch {
      proc.kill('SIGKILL');
    }
  }
});
