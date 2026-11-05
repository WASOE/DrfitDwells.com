import { requestRelease, withApache } from './apache-server.mjs';

const CRITICAL_ROUTES = [
  ['search', '/search?stay=1', '/search'],
  ['checkout', '/checkout?stay=1', '/checkout']
];

export async function probeCriticalRoutes(webroot) {
  return withApache(webroot, async (server) => {
    const failures = [];
    for (const [id, requestPath, expectedPath] of CRITICAL_ROUTES) {
      const response = requestRelease({
        ...server,
        scheme: 'https',
        host: 'driftdwells.com',
        requestPath
      });
      if (response.finalStatus !== 200 || response.finalPath !== expectedPath) {
        failures.push(`${id} ended on ${response.finalStatus} ${response.finalPath}`);
      }
    }
    if (failures.length) {
      throw new Error(`Critical route verification failed: ${failures.join('; ')}`);
    }
    return { ok: true };
  });
}
