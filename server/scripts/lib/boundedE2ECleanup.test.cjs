'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');
const { closeHttpServerBounded } = require('./boundedE2ECleanup.cjs');

test('server close timeout unrefs the listener instead of leaving the process stuck', async () => {
  const server = http.createServer((_req, res) => {
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socket = net.connect(server.address().port);
  await new Promise((resolve) => socket.once('connect', resolve));
  let unrefCalled = false;
  const originalUnref = server.unref.bind(server);
  server.unref = () => {
    unrefCalled = true;
    return originalUnref();
  };
  const originalClose = server.close.bind(server);
  server.close = () => {};
  const started = Date.now();
  await closeHttpServerBounded(server, 'cleanup-test');
  assert.ok(Date.now() - started < 7000);
  assert.equal(unrefCalled, true);
  server.close = originalClose;
  socket.destroy();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => originalClose(resolve));
});
