'use strict';

/**
 * Bounded cleanup for browser E2E. Assertion failures must still release
 * Chromium and the HTTP server so server.close cannot wait forever.
 */

function closeHttpServerBounded(httpServer, label) {
  if (!httpServer) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (message) => {
      if (settled) return;
      settled = true;
      if (message) console.error(`[${label}] ${message}`);
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        if (typeof httpServer.closeAllConnections === 'function') httpServer.closeAllConnections();
      } catch (err) {
        console.error(`[${label}] closeAllConnections failed: ${err.message}`);
      }
      try {
        if (typeof httpServer.unref === 'function') httpServer.unref();
      } catch (err) {
        console.error(`[${label}] server.unref failed: ${err.message}`);
      }
      finish(`${label} server.close timed out after 5000ms`);
    }, 5000);
    try {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
    } catch (err) {
      console.error(`[${label}] closeAllConnections failed: ${err.message}`);
    }
    try {
      httpServer.close((err) => {
        clearTimeout(timer);
        if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
          finish(`${label} server.close failed: ${err.message}`);
          return;
        }
        finish();
      });
    } catch (err) {
      clearTimeout(timer);
      finish(`${label} server.close threw: ${err.message}`);
    }
  });
}

async function closeBrowserBounded(browser, label) {
  if (!browser) return;
  const proc = typeof browser.process === 'function' ? browser.process() : null;
  let timer;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('browser.close timed out after 5000ms')), 5000);
      })
    ]);
  } catch (err) {
    console.error(`[${label}] ${err.message}`);
    if (proc && proc.pid) {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch (groupErr) {
        console.error(`[${label}] failed to kill browser process group ${proc.pid}: ${groupErr.message}`);
      }
      try {
        process.kill(proc.pid, 'SIGKILL');
      } catch (killErr) {
        console.error(`[${label}] failed to kill browser pid ${proc.pid}: ${killErr.message}`);
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  closeBrowserBounded,
  closeHttpServerBounded
};
