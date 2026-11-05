/**
 * Publish a release that has already passed the safety report.
 * Shell and Apache config are snapshotted first. If the post-publish probe
 * reports a critical route failure, those files are restored. Hashed assets
 * already copied are kept so browsers that loaded the previous shell can
 * still fetch it. The API is not restarted.
 */
import { executeLocalPublish } from '../deploy-frontend-safe.lib.mjs';
import { assertReleaseSafetyReport } from './report.mjs';
import { resolveSnapshotDir, restoreFrontendShell, snapshotFrontendShell } from './rollback.mjs';

export async function activateTestedRelease({
  distDir,
  webroot,
  reportPath,
  releaseSha,
  probe,
  uploadsDir = null,
  requirePaymentContract = true,
  verifyRun
}) {
  assertReleaseSafetyReport(reportPath, releaseSha, verifyRun ? { verifyRun } : undefined);
  const snapshot = snapshotFrontendShell(webroot, resolveSnapshotDir(webroot, releaseSha));
  executeLocalPublish({
    distDir,
    webroot,
    uploadsDir,
    dryRun: false,
    requirePaymentContract
  });
  if (!probe) return { ok: true, rolledBack: false, snapshot };
  try {
    const probed = await probe();
    if (probed?.ok) return { ok: true, rolledBack: false, snapshot, probed };
    restoreFrontendShell(webroot, snapshot.snapshotDir);
    return { ok: false, rolledBack: true, snapshot, probed };
  } catch (error) {
    restoreFrontendShell(webroot, snapshot.snapshotDir);
    return { ok: false, rolledBack: true, snapshot, error: error.message };
  }
}
