import fs from 'node:fs';

export function assertReleaseSafetyReport(reportPath, releaseSha) {
  if (!reportPath) {
    throw new Error('Set RELEASE_SAFETY_REPORT to the JSON report from scripts/release-safety/run-gate.mjs.');
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.artifactOk !== true) {
    throw new Error(`Release safety report is not passing: ${(report.artifactBlockers || []).join(', ')}`);
  }
  if (report.deployOk !== true) {
    throw new Error(`Deployment is blocked: ${(report.deploymentBlockers || []).join(', ')}`);
  }
  if (report.frontendRelease !== releaseSha) {
    throw new Error(`Release safety report SHA ${report.frontendRelease} does not match ${releaseSha}.`);
  }
  if (report.coverage?.browser !== 'mocked-apache-artifact') {
    throw new Error('Release safety report is missing mocked Apache browser coverage.');
  }
  if (report.coverage?.staging !== 'isolated-staging-integration') {
    throw new Error('Release safety report is missing isolated staging booking coverage.');
  }
  return report;
}
