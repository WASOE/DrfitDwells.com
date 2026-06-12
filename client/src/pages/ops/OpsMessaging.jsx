import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { decodeRoleFromToken, opsReadAPI, opsWriteAPI } from '../../services/opsApi';

function FlagPill({ label, on }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${
        on ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-gray-50 text-gray-600 border-gray-200'
      }`}
    >
      {label}: {on ? 'On' : 'Off'}
    </span>
  );
}

function readinessBadge(status) {
  const base = 'text-xs px-2 py-0.5 rounded border';
  if (status === 'approved') return `${base} bg-emerald-50 text-emerald-900 border-emerald-200`;
  if (status === 'draft') return `${base} bg-amber-50 text-amber-900 border-amber-200`;
  return `${base} bg-gray-100 text-gray-700 border-gray-200`;
}

function audienceBadgeClass(audience) {
  const base = 'inline-flex text-xs px-1.5 py-0.5 rounded border font-medium capitalize';
  if (audience === 'guest') return `${base} bg-sky-50 text-sky-900 border-sky-200`;
  if (audience === 'ops') return `${base} bg-slate-100 text-slate-800 border-slate-200`;
  if (audience === 'cleaner') return `${base} bg-teal-50 text-teal-900 border-teal-200`;
  return `${base} bg-gray-100 text-gray-700 border-gray-200`;
}

const SHADOW_TOGGLE_CONFIRM =
  'This only enables shadow automation. It will not send real email or WhatsApp. Existing scheduled jobs are not deleted when disabling.';

export default function OpsMessaging() {
  const [system, setSystem] = useState(null);
  const [rulesPayload, setRulesPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [ruleConfirm, setRuleConfirm] = useState({ open: false, ruleKey: '', nextEnabled: false });
  const [ruleSaveBusy, setRuleSaveBusy] = useState(false);
  const [ruleSaveError, setRuleSaveError] = useState('');

  const isAdmin = decodeRoleFromToken() === 'admin';

  const loadMessaging = useCallback(async () => {
    setError('');
    try {
      const [sysRes, rulesRes] = await Promise.all([
        opsReadAPI.messagingSystemState(),
        opsReadAPI.messagingRules()
      ]);
      setSystem(sysRes.data?.data || null);
      setRulesPayload(rulesRes.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load messaging');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadMessaging();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMessaging]);

  const refetchRules = async () => {
    setRefreshing(true);
    setRuleSaveError('');
    try {
      await loadMessaging();
    } finally {
      setRefreshing(false);
    }
  };

  const openRuleToggleConfirm = (ruleKey, nextEnabled) => {
    setRuleSaveError('');
    setRuleConfirm({ open: true, ruleKey, nextEnabled });
  };

  const confirmRuleToggle = async () => {
    const { ruleKey, nextEnabled } = ruleConfirm;
    if (!ruleKey) return;
    setRuleSaveBusy(true);
    setRuleSaveError('');
    try {
      await opsWriteAPI.patchMessagingShadowRuleEnabled(ruleKey, { enabled: nextEnabled });
      setRuleConfirm({ open: false, ruleKey: '', nextEnabled: false });
      await refetchRules();
    } catch (err) {
      setRuleSaveError(err?.response?.data?.message || 'Failed to update rule');
    } finally {
      setRuleSaveBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 py-8 md:py-12">
        <p className="text-sm text-gray-500">Loading guest message automation…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto px-4 py-8 md:py-12">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const rules = rulesPayload?.rules || [];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 md:py-12 lg:py-16 space-y-6 md:space-y-8 pb-20 sm:pb-0">
      <header className="space-y-2">
        <h1 className="text-xl md:text-2xl font-semibold text-gray-900">Guest message automation</h1>
        <p className="text-sm text-gray-600 max-w-2xl">
          System flags and rules overview (guest, ops, and cleaner audiences). Admins can enable or disable{' '}
          <span className="font-medium">shadow</span> rules only (internal providers — no real email or WhatsApp). This
          is separate from legacy booking lifecycle email and Postmark{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">EmailEvent</code> history.
        </p>
      </header>

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">System flags</h2>
        <p className="text-xs text-gray-500 max-w-2xl">
          Values reflect server environment booleans only (no secrets). Shadow mode is active for email unless the real
          provider flag is on.
        </p>
        <div className="flex flex-wrap gap-2">
          <FlagPill label="Dispatcher" on={Boolean(system?.dispatcherEnabled)} />
          <FlagPill label="Scheduler worker" on={Boolean(system?.schedulerWorkerEnabled)} />
          <FlagPill label="Real email provider" on={Boolean(system?.emailProviderEnabled)} />
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 md:p-4 space-y-2 text-xs text-slate-800 max-w-2xl">
          <p className="font-medium text-slate-900">Scheduler vs dispatcher</p>
          <p>{system?.explanations?.schedulerVsDirectDispatcher}</p>
          <p className="font-medium text-slate-900 pt-2">Email provider</p>
          <p>{system?.explanations?.emailProvider}</p>
          <p className="font-medium text-slate-900 pt-2">Dispatcher</p>
          <p>{system?.explanations?.dispatcher}</p>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 overflow-x-auto relative">
        {refreshing ? (
          <p className="absolute top-3 right-4 text-xs text-gray-500 z-10" aria-live="polite">
            Refreshing…
          </p>
        ) : null}
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Rules & template readiness</h2>
        <p className="text-xs text-gray-500 mb-4 max-w-2xl">
          Mode <span className="font-medium">shadow</span> uses internal providers only. <span className="font-medium">auto</span> /{' '}
          <span className="font-medium">manual_approve</span> are not toggled from this page. Template readiness is per channel (locale en,
          property scope from rule).
        </p>
        <div className="min-w-[800px] md:min-w-0">
          <table className="w-full text-left text-xs md:text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600">
                <th className="py-2 pr-3 font-medium">Rule</th>
                <th className="py-2 pr-3 font-medium">Enabled</th>
                <th className="py-2 pr-3 font-medium">Shadow control</th>
                <th className="py-2 pr-3 font-medium">Mode</th>
                <th className="py-2 pr-3 font-medium">Audience</th>
                <th className="py-2 pr-3 font-medium">Scope</th>
                <th className="py-2 pr-3 font-medium">Channels</th>
                <th className="py-2 pr-3 font-medium">Trigger config</th>
                <th className="py-2 pr-3 font-medium">WhatsApp template</th>
                <th className="py-2 pr-3 font-medium">Email template</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.ruleKey} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-gray-900">{r.ruleKey}</div>
                    <div className="text-gray-500 mt-0.5">{r.triggerType}</div>
                  </td>
                  <td className="py-2 pr-3">{r.enabled ? 'Yes' : 'No'}</td>
                  <td className="py-2 pr-3">
                    {isAdmin && r.mode === 'shadow' ? (
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 max-w-[140px]"
                        disabled={ruleSaveBusy}
                        onClick={() => openRuleToggleConfirm(r.ruleKey, !r.enabled)}
                      >
                        {r.enabled ? 'Disable (shadow)' : 'Enable (shadow)'}
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">{!isAdmin ? 'Admins only' : '—'}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        r.mode === 'shadow'
                          ? 'text-violet-800 bg-violet-50 px-1.5 py-0.5 rounded'
                          : 'text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded'
                      }
                    >
                      {r.mode}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={audienceBadgeClass(r.audience)}>{r.audience || '—'}</span>
                  </td>
                  <td className="py-2 pr-3">{r.propertyScope}</td>
                  <td className="py-2 pr-3">{r.channelStrategy}</td>
                  <td className="py-2 pr-3">
                    <code className="text-[10px] md:text-xs text-gray-700 whitespace-pre-wrap break-all max-w-[180px] inline-block align-top">
                      {r.triggerConfig && Object.keys(r.triggerConfig).length
                        ? JSON.stringify(r.triggerConfig)
                        : '{}'}
                    </code>
                  </td>
                  <td className="py-2 pr-3">
                    <div className={readinessBadge(r.templateReadinessByChannel?.whatsapp)}>{r.templateReadinessByChannel?.whatsapp}</div>
                    <div className="text-gray-500 mt-1 truncate max-w-[140px]" title={r.templateKeyByChannel?.whatsapp || ''}>
                      {r.templateKeyByChannel?.whatsapp || '—'}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <div className={readinessBadge(r.templateReadinessByChannel?.email)}>{r.templateReadinessByChannel?.email}</div>
                    <div className="text-gray-500 mt-1 truncate max-w-[140px]" title={r.templateKeyByChannel?.email || ''}>
                      {r.templateKeyByChannel?.email || '—'}
                    </div>
                  </td>
                </tr>
              ))}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-4 text-gray-500">
                    No automation rules in database.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 pt-2">
          Per-booking jobs and dispatches: open a{' '}
          <Link to="/ops/reservations" className="text-[#81887A] underline underline-offset-2">
            reservation
          </Link>{' '}
          and see the &quot;Guest message automation&quot; panel.
        </p>
      </section>

      {ruleConfirm.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ops-messaging-rule-confirm-title"
        >
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full p-4 md:p-6 space-y-4 border border-gray-200">
            <h2 id="ops-messaging-rule-confirm-title" className="text-sm font-semibold text-gray-900">
              Confirm rule change
            </h2>
            <p className="text-sm text-gray-700">{SHADOW_TOGGLE_CONFIRM}</p>
            <p className="text-xs text-gray-500">
              Rule: <span className="font-medium text-gray-800">{ruleConfirm.ruleKey}</span> →{' '}
              <span className="font-medium text-gray-800">{ruleConfirm.nextEnabled ? 'enabled' : 'disabled'}</span>
            </p>
            {ruleSaveError ? <p className="text-sm text-red-600">{ruleSaveError}</p> : null}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
                disabled={ruleSaveBusy}
                onClick={() => !ruleSaveBusy && setRuleConfirm({ open: false, ruleKey: '', nextEnabled: false })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="text-sm px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
                disabled={ruleSaveBusy}
                onClick={confirmRuleToggle}
              >
                {ruleSaveBusy ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
