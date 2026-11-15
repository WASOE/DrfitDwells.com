/**
 * The legacy helper published static files in place and only restored the
 * shell. It must not be used until release-level activation is available.
 */
export async function activateTestedRelease() {
  throw new Error('Legacy frontend activation is disabled: complete release-level rollback is not available.');
}
