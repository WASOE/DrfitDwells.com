import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkReleaseDocroot, requestRelease, withApache } from './apache-server.mjs';
import { ROUTING_CASES, evaluateRoutingCase } from './routing-contract.mjs';

export async function runRoutingAgainstHtaccess(distDir, htaccessText) {
  const docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-docroot-'));
  linkReleaseDocroot(distDir, docroot, htaccessText);
  return withApache(docroot, async (server) => {
    const failures = [];
    const results = [];
    for (const testCase of ROUTING_CASES) {
      const response = requestRelease({
        ...server,
        scheme: testCase.scheme,
        host: testCase.host,
        requestPath: testCase.path
      });
      const evaluated = evaluateRoutingCase(testCase, response);
      results.push({ id: testCase.id, ...response, ...evaluated });
      if (!evaluated.ok) failures.push(...evaluated.errors);
    }
    return { ok: failures.length === 0, failures, results };
  });
}

export function idsThatFailed(routing) {
  return [...new Set(routing.results.filter((result) => !result.ok).map((result) => result.id))];
}
