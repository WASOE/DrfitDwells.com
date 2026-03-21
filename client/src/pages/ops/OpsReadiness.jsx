import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';
import { Link } from 'react-router-dom';

function verdictStyle(verdict) {
  switch (verdict) {
    case 'ready_for_primary_use':
      return { bg: 'bg-emerald-50 border-emerald-200 text-emerald-800', label: 'Ready for primary use' };
    case 'ready_for_restricted_cutover':
      return { bg: 'bg-amber-50 border-amber-200 text-amber-800', label: 'Ready for restricted cutover' };
    case 'conditionally_ready':
      return { bg: 'bg-yellow-50 border-yellow-200 text-yellow-800', label: 'Conditionally ready' };
    case 'not_ready':
    default:
      return { bg: 'bg-red-50 border-red-200 text-red-800', label: 'Not ready' };
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
        const [modulesResp, qaResp] = await Promise.all([opsReadAPI.readinessModules(), opsReadAPI.readinessQa()]);
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

  if (loading) return <div className="text-sm text-gray-500">Loading readiness...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!summary) return <div className="text-sm text-gray-500">No readiness data.</div>;

  const moduleKeys = Object.keys(summary).sort();

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Cutover readiness</h2>
            <p className="text-sm text-gray-500 mt-1">Evidence-based module verdicts + overlap status.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link to="/ops" className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50">
              Dashboard
            </Link>
            <Link to="/ops/manual-review" className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50">
              Manual review
            </Link>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {moduleKeys.map((k) => {
          const m = summary[k];
          const v = verdictStyle(m?.readiness?.verdict);
          const overlap = m?.readiness?.overlapStatus;
          const blocking = m?.readiness?.blockingErrorCount || 0;
          const issues = m?.blockingIssues || [];
          const relevantCategories = m?.manualReviewLinkage?.relevantCategories || null;
          const openManualReviewCount = m?.manualReviewLinkage?.openManualReviewCount ?? null;
          const cutover = m?.cutover || {};

          return (
            <section key={k} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 capitalize">{k.replace('_', ' ')}</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Verdict: <span className={`inline-block px-2 py-0.5 rounded border ${v.bg} border ${v.bg}`}>{v.label}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Overlap status: {overlap}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Cutover: opsPrimary={cutover.opsPrimary ? 'yes' : 'no'} · adminWrite={cutover.adminWriteOverlapStatus || 'target_for_cutover'}
                  </p>
                </div>
                <div className="text-right">
                  <div className={`inline-flex items-center px-2 py-1 rounded border ${blocking > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                    Blocking errors: {blocking}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs text-gray-500 uppercase tracking-wide">Parity mismatch summary</div>
                <div className="mt-1 text-sm text-gray-700">
                  mismatches: {m?.parity?.mismatchCount || 0} (critical: {m?.parity?.criticalMismatchCount || 0}, non-critical: {m?.parity?.nonCriticalMismatchCount || 0})
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Evidence: {m?.evidence?.hasEvidence ? 'sufficient' : 'insufficient'}
                </div>
              </div>

              {issues.length ? (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Blocking issues</div>
                  <div className="mt-2 space-y-1">
                    {issues.slice(0, 5).map((it, idx) => (
                      <div key={`${k}-${idx}`} className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                        {it}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-sm text-gray-500">No blocking parity issues.</div>
              )}

              {relevantCategories ? (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Operational manual review linkage</div>
                  <div className="mt-1 text-sm text-gray-700">
                    Open items for categories: <span className="font-mono">{relevantCategories.join(', ')}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Open manual review count (module): {openManualReviewCount}</div>
                </div>
              ) : null}

              {cutover ? (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">Rollback</div>
                  <div className="mt-1 text-sm text-gray-700">
                    {cutover.rollbackAvailable ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-900">
                        Available
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-700">
                        Not available
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {qa ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900">Operational QA smoke</h3>
          <p className="text-sm text-gray-500 mt-1">
            Pass/fail for route-backed read-model assemblies. If an item fails, parity verdicts may reflect that.
          </p>
          <div className="mt-3 space-y-2">
            {Object.entries(qa.qaSmoke || {}).map(([name, v]) => (
              <div key={name} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${v.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <div className="text-sm font-medium text-gray-900">{name}</div>
                <div className="text-xs text-gray-700">
                  {v.ok ? 'PASS' : `FAIL: ${String(v.error || 'unknown')}`}
                </div>
              </div>
            ))}
            {Object.keys(qa.qaSmoke || {}).length === 0 ? <div className="text-sm text-gray-500">No QA smoke output.</div> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

