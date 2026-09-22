import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import './OpsReadiness.css';

function readinessStatusName(verdict) {
  switch (verdict) {
    case 'ready_for_primary_use':
      return 'readiness.ready';
    case 'ready_for_restricted_cutover':
      return 'readiness.restricted';
    case 'conditionally_ready':
      return 'readiness.conditional';
    case 'not_ready':
    default:
      return 'readiness.not_ready';
  }
}

export default function OpsReadiness() {
  const [summary, setSummary] = useState(null);
  const [qa, setQa] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [modulesResp, qaResp] = await Promise.all([
          opsReadAPI.readinessModules(),
          opsReadAPI.readinessQa()
        ]);
        if (cancelled) return;
        setSummary(modulesResp.data?.data || null);
        setQa(qaResp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load readiness');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const moduleKeys = summary ? Object.keys(summary).sort() : [];

  return (
    <OpsPage width="wide" className="ops-readiness">
      <div data-testid="ops-readiness-page">
        <OpsPageHeader
          title="Cutover readiness"
          description="Evidence-based module verdicts + overlap status."
          actions={
            <div className="ops-readiness__actions">
              <Link to="/ops" className="ops-readiness__link">
                Dashboard
              </Link>
              <Link to="/ops/manual-review" className="ops-readiness__link">
                Manual review
              </Link>
            </div>
          }
        />

        {error ? <OpsBanner tone="danger" body={error} /> : null}

        {loading ? (
          <OpsLoadingState label="Loading readiness..." data-testid="readiness-loading" />
        ) : !summary && !error ? (
          <p className="ops-readiness__note">No readiness data.</p>
        ) : summary ? (
          <>
            <div className="ops-readiness__grid" data-testid="readiness-modules">
              {moduleKeys.map((k) => {
                const m = summary[k];
                const blocking = m?.readiness?.blockingErrorCount || 0;
                const overlap = m?.readiness?.overlapStatus;
                const issues = m?.blockingIssues || [];
                const relevantCategories = m?.manualReviewLinkage?.relevantCategories || null;
                const openManualReviewCount = m?.manualReviewLinkage?.openManualReviewCount ?? null;
                const cutover = m?.cutover || {};

                return (
                  <OpsSurface key={k} className="ops-readiness__module" data-testid={`readiness-module-${k}`}>
                    <OpsSurfaceHeader className="ops-readiness__module-head">
                      <div className="min-w-0">
                        <OpsSurfaceTitle as="h3" className="ops-readiness__module-title">
                          {k.replace('_', ' ')}
                        </OpsSurfaceTitle>
                        <p className="ops-readiness__meta">
                          Verdict: <OpsStatus name={readinessStatusName(m?.readiness?.verdict)} />
                        </p>
                        <p className="ops-readiness__meta">Overlap status: {overlap}</p>
                        <p className="ops-readiness__meta">
                          Cutover: opsPrimary={cutover.opsPrimary ? 'yes' : 'no'} · adminWrite=
                          {cutover.adminWriteOverlapStatus || 'target_for_cutover'}
                        </p>
                      </div>
                      <div
                        className={`ops-readiness__chip ${
                          blocking > 0 ? 'ops-readiness__chip--danger' : 'ops-readiness__chip--ok'
                        }`}
                      >
                        Blocking errors: {blocking}
                      </div>
                    </OpsSurfaceHeader>

                    <div>
                      <p className="ops-readiness__section-label">Parity mismatch summary</p>
                      <p className="ops-readiness__body">
                        mismatches: {m?.parity?.mismatchCount || 0} (critical:{' '}
                        {m?.parity?.criticalMismatchCount || 0}, non-critical:{' '}
                        {m?.parity?.nonCriticalMismatchCount || 0})
                      </p>
                      <p className="ops-readiness__meta">
                        Evidence: {m?.evidence?.hasEvidence ? 'sufficient' : 'insufficient'}
                      </p>
                    </div>

                    {issues.length ? (
                      <div>
                        <p className="ops-readiness__section-label">Blocking issues</p>
                        <div className="ops-readiness__issues">
                          {issues.slice(0, 5).map((it, idx) => (
                            <p key={`${k}-${idx}`} className="ops-readiness__issue">
                              {it}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="ops-readiness__note">No blocking parity issues.</p>
                    )}

                    {relevantCategories ? (
                      <div className="ops-readiness__divider">
                        <p className="ops-readiness__section-label">
                          Operational manual review linkage
                        </p>
                        <p className="ops-readiness__body">
                          Open items for categories:{' '}
                          <span className="ops-readiness__mono">{relevantCategories.join(', ')}</span>
                        </p>
                        <p className="ops-readiness__meta">
                          Open manual review count (module): {openManualReviewCount}
                        </p>
                      </div>
                    ) : null}

                    {cutover ? (
                      <div>
                        <p className="ops-readiness__section-label">Rollback</p>
                        <p className="ops-readiness__body">
                          {cutover.rollbackAvailable ? (
                            <span className="ops-readiness__chip ops-readiness__chip--warn">
                              Available
                            </span>
                          ) : (
                            <span className="ops-readiness__chip ops-readiness__chip--neutral">
                              Not available
                            </span>
                          )}
                        </p>
                      </div>
                    ) : null}
                  </OpsSurface>
                );
              })}
            </div>

            {qa ? (
              <OpsSurface className="ops-readiness__surface" data-testid="readiness-qa">
                <OpsSurfaceTitle as="h3" className="ops-readiness__surface-title">
                  Operational QA smoke
                </OpsSurfaceTitle>
                <p className="ops-readiness__note">
                  Pass/fail for route-backed read-model assemblies. If an item fails, parity verdicts
                  may reflect that.
                </p>
                <div className="ops-readiness__qa-list">
                  {Object.entries(qa.qaSmoke || {}).map(([name, v]) => (
                    <div
                      key={name}
                      className={`ops-readiness__qa-row ${
                        v.ok ? 'ops-readiness__qa-row--pass' : 'ops-readiness__qa-row--fail'
                      }`}
                    >
                      <div className="ops-readiness__qa-name">{name}</div>
                      <div className="ops-readiness__qa-result">
                        {v.ok ? 'PASS' : `FAIL: ${String(v.error || 'unknown')}`}
                      </div>
                    </div>
                  ))}
                  {Object.keys(qa.qaSmoke || {}).length === 0 ? (
                    <p className="ops-readiness__note">No QA smoke output.</p>
                  ) : null}
                </div>
              </OpsSurface>
            ) : null}
          </>
        ) : null}
      </div>
    </OpsPage>
  );
}
