import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { decodeRoleFromToken, opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsConfirmDialog from '../../ops/primitives/OpsConfirmDialog';
import OpsTable, {
  OpsTableBody,
  OpsTableCell,
  OpsTableHead,
  OpsTableHeader,
  OpsTableRow
} from '../../ops/primitives/OpsTable';
import './OpsMessaging.css';

const SHADOW_TOGGLE_CONFIRM =
  'This only enables shadow automation. It will not send real email or WhatsApp. Existing scheduled jobs are not deleted when disabling.';

const MODE_LABELS = {
  shadow: 'Shadow',
  auto: 'Auto',
  manual_approve: 'Manual approval'
};

const AUDIENCE_LABELS = {
  guest: 'Guest',
  ops: 'Ops',
  cleaner: 'Cleaner'
};

const SCOPE_LABELS = {
  cabin: 'The Cabin',
  valley: 'The Valley',
  any: 'Any'
};

const CHANNEL_STRATEGY_LABELS = {
  whatsapp_only: 'WhatsApp only',
  email_only: 'Email only',
  whatsapp_first_email_fallback: 'WhatsApp first, email fallback',
  both: 'Both'
};

const TRIGGER_TYPE_LABELS = {
  time_relative_to_check_in: 'Time relative to check-in',
  time_relative_to_check_out: 'Time relative to check-out',
  booking_status_change: 'Booking status change',
  manual: 'Manual'
};

function humanizeKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  return raw
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function labelFromMap(map, value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (Object.prototype.hasOwnProperty.call(map, raw)) return map[raw];
  return humanizeKey(raw);
}

function modeLabel(mode) {
  return labelFromMap(MODE_LABELS, mode);
}

function audienceLabel(audience) {
  return labelFromMap(AUDIENCE_LABELS, audience);
}

function scopeLabel(scope) {
  return labelFromMap(SCOPE_LABELS, scope);
}

function channelStrategyLabel(strategy) {
  return labelFromMap(CHANNEL_STRATEGY_LABELS, strategy);
}

function triggerTypeLabel(triggerType) {
  return labelFromMap(TRIGGER_TYPE_LABELS, triggerType);
}

function triggerConfigText(triggerConfig) {
  if (triggerConfig && typeof triggerConfig === 'object' && Object.keys(triggerConfig).length) {
    return JSON.stringify(triggerConfig);
  }
  return '{}';
}

function FlagState({ label, on }) {
  return (
    <li className="ops-messaging-flag">
      <span className="ops-messaging-flag__label">{label}</span>
      <OpsBadge tone={on ? 'info' : 'neutral'}>{on ? 'On' : 'Off'}</OpsBadge>
    </li>
  );
}

function TemplateReadiness({ status }) {
  if (status === 'approved') {
    return <OpsStatus domain="template" value="approved" />;
  }
  if (status === 'draft') {
    return <OpsStatus domain="template" value="draft" />;
  }
  if (status === 'missing') {
    return <OpsBadge tone="neutral">Missing</OpsBadge>;
  }
  if (!status) return '—';
  return <OpsBadge tone="neutral">{humanizeKey(status)}</OpsBadge>;
}

function TemplateChannel({ channelLabel, status, templateKey }) {
  return (
    <div className="ops-messaging-template-channel">
      <p className="ops-messaging-template-channel__label">{channelLabel}</p>
      <TemplateReadiness status={status} />
      <p className="ops-messaging-template-key">{templateKey || '—'}</p>
    </div>
  );
}

function RuleIdentity({ rule }) {
  return (
    <div>
      <p className="ops-messaging-rule-key">{rule.ruleKey}</p>
      <p className="ops-messaging-rule-trigger">{triggerTypeLabel(rule.triggerType)}</p>
    </div>
  );
}

function ShadowControl({ rule, isAdmin, busy, onToggle }) {
  if (isAdmin && rule.mode === 'shadow') {
    return (
      <OpsButton
        variant="secondary"
        size="compact"
        disabled={busy}
        onClick={() => onToggle(rule.ruleKey, !rule.enabled)}
      >
        {rule.enabled ? 'Disable shadow' : 'Enable shadow'}
      </OpsButton>
    );
  }
  return <p className="ops-messaging-readonly">{isAdmin ? '—' : 'Admins only'}</p>;
}

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

  const closeRuleToggleConfirm = () => {
    if (ruleSaveBusy) return;
    setRuleConfirm({ open: false, ruleKey: '', nextEnabled: false });
    setRuleSaveError('');
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

  const rules = rulesPayload?.rules || [];
  const showData = !loading && !error;

  return (
    <OpsPage width="wide">
      <div className="ops-messaging">
        <OpsPageHeader
          title="Messaging"
          description="Guest Message Automation system flags and rules. Admins can enable or disable shadow rules only (internal providers — no real email or WhatsApp). This is separate from booking lifecycle emails and Postmark EmailEvent evidence."
        />

        {loading ? <OpsLoadingState label="Loading guest message automation…" /> : null}

        {!loading && error ? <OpsBanner tone="danger" body={error} /> : null}

        {showData ? (
          <>
            <section className="ops-messaging-surface" aria-labelledby="ops-messaging-flags-title">
              <div className="ops-messaging-surface__head">
                <h2 id="ops-messaging-flags-title" className="ops-messaging-surface__title">
                  System flags
                </h2>
              </div>
              <p className="ops-messaging-note">
                Values reflect server environment booleans only (no secrets). Shadow mode is active for email unless the
                real provider flag is on.
              </p>
              <ul className="ops-messaging-flags">
                <FlagState label="Dispatcher" on={Boolean(system?.dispatcherEnabled)} />
                <FlagState label="Scheduler worker" on={Boolean(system?.schedulerWorkerEnabled)} />
                <FlagState label="Real email provider" on={Boolean(system?.emailProviderEnabled)} />
              </ul>
              <div className="ops-messaging-explanations">
                <p>
                  <strong>Scheduler vs dispatcher</strong>
                  {system?.explanations?.schedulerVsDirectDispatcher}
                </p>
                <p>
                  <strong>Email provider</strong>
                  {system?.explanations?.emailProvider}
                </p>
                <p>
                  <strong>Dispatcher</strong>
                  {system?.explanations?.dispatcher}
                </p>
              </div>
            </section>

            <section className="ops-messaging-surface" aria-labelledby="ops-messaging-rules-title">
              <div className="ops-messaging-surface__head">
                <h2 id="ops-messaging-rules-title" className="ops-messaging-surface__title">
                  Rules & template readiness
                </h2>
                {refreshing ? (
                  <p className="ops-messaging-refresh" aria-live="polite">
                    Refreshing…
                  </p>
                ) : null}
              </div>
              <p className="ops-messaging-note">
                Mode Shadow uses internal providers only. Auto / Manual approval are not toggled from this page. Template
                readiness is per channel (locale en, property scope from rule).
              </p>

              <div className="ops-messaging-table">
                <OpsTable caption="Guest message automation rules">
                  <OpsTableHead>
                    <OpsTableRow>
                      <OpsTableHeader>Rule</OpsTableHeader>
                      <OpsTableHeader>State</OpsTableHeader>
                      <OpsTableHeader>Mode / Audience</OpsTableHeader>
                      <OpsTableHeader>Scope / channels</OpsTableHeader>
                      <OpsTableHeader>Trigger</OpsTableHeader>
                      <OpsTableHeader>Templates</OpsTableHeader>
                    </OpsTableRow>
                  </OpsTableHead>
                  <OpsTableBody>
                    {rules.map((rule) => (
                      <OpsTableRow key={`table-${rule.ruleKey}`}>
                        <OpsTableCell>
                          <RuleIdentity rule={rule} />
                        </OpsTableCell>
                        <OpsTableCell>
                          <div className="ops-messaging-state">
                            <OpsBadge tone="neutral">{rule.enabled ? 'Enabled' : 'Disabled'}</OpsBadge>
                            <ShadowControl
                              rule={rule}
                              isAdmin={isAdmin}
                              busy={ruleSaveBusy}
                              onToggle={openRuleToggleConfirm}
                            />
                          </div>
                        </OpsTableCell>
                        <OpsTableCell>
                          <div className="ops-messaging-meta">
                            <OpsBadge tone="neutral">{modeLabel(rule.mode)}</OpsBadge>
                            <span>{audienceLabel(rule.audience)}</span>
                          </div>
                        </OpsTableCell>
                        <OpsTableCell>
                          <div className="ops-messaging-meta">
                            <span>{scopeLabel(rule.propertyScope)}</span>
                            <span>{channelStrategyLabel(rule.channelStrategy)}</span>
                          </div>
                        </OpsTableCell>
                        <OpsTableCell>
                          <pre className="ops-messaging-config">{triggerConfigText(rule.triggerConfig)}</pre>
                        </OpsTableCell>
                        <OpsTableCell>
                          <div className="ops-messaging-templates">
                            <TemplateChannel
                              channelLabel="WhatsApp"
                              status={rule.templateReadinessByChannel?.whatsapp}
                              templateKey={rule.templateKeyByChannel?.whatsapp}
                            />
                            <TemplateChannel
                              channelLabel="Email"
                              status={rule.templateReadinessByChannel?.email}
                              templateKey={rule.templateKeyByChannel?.email}
                            />
                          </div>
                        </OpsTableCell>
                      </OpsTableRow>
                    ))}
                    {rules.length === 0 ? (
                      <OpsTableRow>
                        <OpsTableCell colSpan={6}>
                          <p className="ops-messaging-empty">No automation rules in database.</p>
                        </OpsTableCell>
                      </OpsTableRow>
                    ) : null}
                  </OpsTableBody>
                </OpsTable>
              </div>

              <div className="ops-messaging-rows">
                {rules.length === 0 ? (
                  <p className="ops-messaging-empty">No automation rules in database.</p>
                ) : (
                  rules.map((rule) => (
                    <article key={`row-${rule.ruleKey}`} className="ops-messaging-row">
                      <RuleIdentity rule={rule} />
                      <dl className="ops-messaging-facts">
                        <div>
                          <dt>Enabled</dt>
                          <dd>
                            <OpsBadge tone="neutral">{rule.enabled ? 'Enabled' : 'Disabled'}</OpsBadge>
                          </dd>
                        </div>
                        <div>
                          <dt>Mode</dt>
                          <dd>
                            <OpsBadge tone="neutral">{modeLabel(rule.mode)}</OpsBadge>
                          </dd>
                        </div>
                        <div>
                          <dt>Audience</dt>
                          <dd>{audienceLabel(rule.audience)}</dd>
                        </div>
                        <div>
                          <dt>Scope</dt>
                          <dd>{scopeLabel(rule.propertyScope)}</dd>
                        </div>
                        <div>
                          <dt>Channels</dt>
                          <dd>{channelStrategyLabel(rule.channelStrategy)}</dd>
                        </div>
                        <div>
                          <dt>Trigger config</dt>
                          <dd>
                            <pre className="ops-messaging-config">{triggerConfigText(rule.triggerConfig)}</pre>
                          </dd>
                        </div>
                      </dl>
                      <div className="ops-messaging-templates">
                        <TemplateChannel
                          channelLabel="WhatsApp"
                          status={rule.templateReadinessByChannel?.whatsapp}
                          templateKey={rule.templateKeyByChannel?.whatsapp}
                        />
                        <TemplateChannel
                          channelLabel="Email"
                          status={rule.templateReadinessByChannel?.email}
                          templateKey={rule.templateKeyByChannel?.email}
                        />
                      </div>
                      <ShadowControl
                        rule={rule}
                        isAdmin={isAdmin}
                        busy={ruleSaveBusy}
                        onToggle={openRuleToggleConfirm}
                      />
                    </article>
                  ))
                )}
              </div>

              <p className="ops-messaging-note">
                Per-booking jobs and dispatches: open a{' '}
                <Link to="/ops/reservations" className="ops-messaging-link">
                  reservation
                </Link>{' '}
                and see the &quot;Guest message automation&quot; panel.
              </p>
            </section>
          </>
        ) : null}
      </div>

      <OpsConfirmDialog
        open={ruleConfirm.open}
        title="Confirm rule change"
        body={SHADOW_TOGGLE_CONFIRM}
        confirmLabel={ruleConfirm.nextEnabled ? 'Enable' : 'Disable'}
        loading={ruleSaveBusy}
        onConfirm={confirmRuleToggle}
        onCancel={closeRuleToggleConfirm}
      >
        <p className="ops-messaging-note">
          Rule: <span>{ruleConfirm.ruleKey}</span> → {ruleConfirm.nextEnabled ? 'enabled' : 'disabled'}
        </p>
        {ruleSaveError ? <OpsInlineError>{ruleSaveError}</OpsInlineError> : null}
      </OpsConfirmDialog>
    </OpsPage>
  );
}
