import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsSurface, { OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsBadge from '../../ops/primitives/OpsBadge';
import './OpsBuildEnquiries.css';

const BACK = { to: '/ops/build-enquiries', label: 'Build enquiries' };

const STATUS_LABELS = {
  new: 'New',
  in_progress: 'In progress',
  closed: 'Closed'
};

const EMAIL_STATUS_LABELS = {
  pending: 'Pending',
  sending: 'Sending',
  succeeded: 'Succeeded',
  failed: 'Failed',
  needs_manual: 'Needs manual'
};

function Fact({ label, children }) {
  return (
    <div>
      <dt className="ops-be-fact-label">{label}</dt>
      <dd className="ops-be-fact-value">{children ?? '—'}</dd>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

function EmailLaneCard({ title, lane }) {
  const status = lane?.status || 'pending';
  const alert = status === 'failed' || status === 'needs_manual';
  return (
    <div
      className={`ops-be-email-lane${alert ? ' ops-be-email-lane--alert' : ''}`}
      data-testid={`ops-be-email-${title.toLowerCase()}`}
    >
      <div className="ops-be-email-lane__title">{title}</div>
      <div>
        <OpsBadge>{EMAIL_STATUS_LABELS[status] || status}</OpsBadge>
      </div>
      <div className="ops-be-muted">
        Attempts {lane?.attemptCount ?? 0}/{lane?.maxAttempts ?? 10}
        {lane?.nextAttemptAt ? ` · Next ${formatDate(lane.nextAttemptAt)}` : ''}
      </div>
      {status === 'needs_manual' ? (
        <p className="ops-be-alert">Manual follow-up required — automated retries stopped.</p>
      ) : null}
      {status === 'failed' ? (
        <p className="ops-be-alert">Delivery failed — scheduled for retry if attempts remain.</p>
      ) : null}
    </div>
  );
}

export default function OpsBuildEnquiryDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusDraft, setStatusDraft] = useState('new');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.buildEnquiryDetail(id);
      const detail = resp.data?.data || null;
      setData(detail);
      setStatusDraft(detail?.status || 'new');
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load build enquiry');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const saveStatus = async () => {
    setSaving(true);
    setActionError('');
    try {
      const resp = await opsWriteAPI.patchBuildEnquiryStatus(id, statusDraft);
      setData(resp.data?.data || null);
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <OpsPage width="wide" className="ops-be-page">
        <OpsPageHeader back={BACK} title="Build enquiry" />
        <OpsLoadingState label="Loading enquiry…" />
      </OpsPage>
    );
  }

  if (error || !data) {
    return (
      <OpsPage width="wide" className="ops-be-page">
        <OpsPageHeader back={BACK} title="Build enquiry" />
        <OpsEmptyState title="Enquiry not found" body={error || 'This enquiry could not be loaded.'} />
      </OpsPage>
    );
  }

  const attention = data.emails?.attention;
  const showEmailBanner = attention?.hasNeedsManual || attention?.hasFailed;

  return (
    <OpsPage width="wide" className="ops-be-page" data-testid="ops-build-enquiry-detail">
      <OpsPageHeader
        back={BACK}
        title={data.projectReference || 'Build enquiry'}
        meta={<OpsBadge>{STATUS_LABELS[data.status] || data.status}</OpsBadge>}
        description={`Received ${formatDate(data.createdAt)}`}
      />

      {showEmailBanner ? (
        <OpsBanner
          tone="danger"
          body={
            attention.hasNeedsManual
              ? 'One or more email lanes need manual intervention.'
              : 'One or more email deliveries failed.'
          }
        />
      ) : null}
      {actionError ? <OpsBanner tone="danger" body={actionError} /> : null}

      <OpsSurface>
        <OpsSurfaceTitle>Workflow</OpsSurfaceTitle>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
          <OpsSelect
            label="Status"
            value={statusDraft}
            onChange={(e) => setStatusDraft(e.target.value)}
          >
            <option value="new">New</option>
            <option value="in_progress">In progress</option>
            <option value="closed">Closed</option>
          </OpsSelect>
          <OpsButton type="button" onClick={saveStatus} disabled={saving || statusDraft === data.status}>
            {saving ? 'Saving…' : 'Update status'}
          </OpsButton>
        </div>
      </OpsSurface>

      <div className="ops-be-detail-grid">
        <OpsSurface>
          <OpsSurfaceTitle>Contact</OpsSurfaceTitle>
          <dl className="ops-be-facts">
            <Fact label="Name">{data.contact?.name}</Fact>
            <Fact label="Email">{data.contact?.email}</Fact>
            <Fact label="Phone">{data.contact?.phone || '—'}</Fact>
          </dl>
        </OpsSurface>

        <OpsSurface>
          <OpsSurfaceTitle>Project requirements</OpsSurfaceTitle>
          <dl className="ops-be-facts">
            <Fact label="Location">{data.project?.location}</Fact>
            <Fact label="Land status">{data.project?.landStatus}</Fact>
            <Fact label="Budget">{data.project?.budget}</Fact>
            <Fact label="Timeline">{data.project?.timeline}</Fact>
          </dl>
          {data.project?.message ? (
            <p className="ops-be-fact-value" style={{ marginTop: 12 }}>
              {data.project.message}
            </p>
          ) : null}
        </OpsSurface>

        <OpsSurface>
          <OpsSurfaceTitle>Configuration</OpsSurfaceTitle>
          <dl className="ops-be-facts">
            <Fact label="Model">{data.config?.modelLabel}</Fact>
            <Fact label="Partial config">{data.configMeta?.isPartial ? 'Yes' : 'No'}</Fact>
            {data.config?.customDimensions ? (
              <Fact label="Custom size">
                {data.config.customDimensions.length} × {data.config.customDimensions.width} m
              </Fact>
            ) : null}
          </dl>
          {Object.keys(data.config?.radioLabels || {}).length ? (
            <ul className="ops-be-config-list">
              {Object.entries(data.config.radioLabels).map(([key, label]) => (
                <li key={key}>
                  {key}: {label}
                </li>
              ))}
            </ul>
          ) : null}
          {data.config?.toggleLabels?.length ? (
            <ul className="ops-be-config-list">
              {data.config.toggleLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          ) : null}
        </OpsSurface>

        <OpsSurface>
          <OpsSurfaceTitle>Indicative estimate</OpsSurfaceTitle>
          <p className="ops-be-fact-value">{data.estimate?.displayLabel || '—'}</p>
          <p className="ops-be-muted">
            Client-displayed figure{data.estimate?.unverified ? ' (unverified)' : ''}. Not a binding
            quote.
          </p>
        </OpsSurface>

        <OpsSurface>
          <OpsSurfaceTitle>Email delivery</OpsSurfaceTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <EmailLaneCard title="Internal" lane={data.emails?.internal} />
            <EmailLaneCard title="Customer" lane={data.emails?.customer} />
          </div>
        </OpsSurface>

        <OpsSurface>
          <OpsSurfaceTitle>Attribution</OpsSurfaceTitle>
          <dl className="ops-be-facts">
            <Fact label="Source">{data.attribution?.source || data.attribution?.utmSource || '—'}</Fact>
            <Fact label="Medium">{data.attribution?.medium || data.attribution?.utmMedium || '—'}</Fact>
            <Fact label="Campaign">
              {data.attribution?.campaign || data.attribution?.utmCampaign || '—'}
            </Fact>
            <Fact label="Referrer">{data.attribution?.referrer || '—'}</Fact>
          </dl>
        </OpsSurface>
      </div>
    </OpsPage>
  );
}
