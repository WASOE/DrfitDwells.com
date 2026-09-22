import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import ManualReviewResolveAction from '../../components/ops/ManualReviewResolveAction';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import './OpsManualReviewBacklog.css';

function isMongoObjectIdString(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

/** For comms_* categories, link to OPS reservation when booking id is known. */
function resolveCommsReservationHref(item) {
  if (!item?.category || !String(item.category).startsWith('comms_')) return null;
  const fromEvidence = item.evidence?.bookingId;
  if (isMongoObjectIdString(fromEvidence)) return `/ops/reservations/${fromEvidence}`;
  if (item.entityType === 'booking' && isMongoObjectIdString(item.entityId)) {
    return `/ops/reservations/${item.entityId}`;
  }
  return null;
}

function reviewStatusValue(item) {
  if (item?.severity === 'critical') return 'critical';
  if (item?.severity === 'high') return 'high';
  return item?.status || 'open';
}

function urgencyClass(item) {
  if (item?.severity === 'critical') return 'ops-mr-item--critical';
  if (item?.severity === 'high') return 'ops-mr-item--high';
  return '';
}

function ReviewStatus({ item }) {
  return (
    <span className="ops-mr-item__status">
      <OpsStatus domain="manual_review" value={reviewStatusValue(item)} />
    </span>
  );
}

export default function OpsManualReviewBacklog() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.manualReview({ page: 1, limit: 50, status: 'open' });
      setData(resp.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load manual review backlog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const items = data?.items || [];
  const itemCount = items.length ? `${items.length} item(s)` : null;

  return (
    <OpsPage width="wide" className="ops-mr-page">
      <OpsPageHeader
        title="Manual review"
        description="Open operational items requiring operator action."
        meta={!loading && !error && itemCount ? itemCount : null}
      />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      {loading ? (
        <OpsLoadingState label="Loading manual review backlog" />
      ) : error ? null : !data ? (
        <OpsEmptyState title="No manual review backlog data." />
      ) : items.length === 0 ? (
        <OpsEmptyState title="Nothing to review right now." />
      ) : (
        <OpsSurface className="ops-mr-surface" aria-labelledby="ops-mr-backlog">
          <OpsSurfaceHeader className="ops-mr-surface__head">
            <OpsSurfaceTitle id="ops-mr-backlog" className="ops-mr-surface__title">
              Open backlog
            </OpsSurfaceTitle>
          </OpsSurfaceHeader>
          <div className="ops-mr-list" role="list">
            {items.map((item) => {
              const reservationHref = resolveCommsReservationHref(item);
              const showSeverityText =
                reviewStatusValue(item) !== 'high' && reviewStatusValue(item) !== 'critical';
              return (
                <article
                  key={item.manualReviewItemId}
                  className={`ops-mr-item ${urgencyClass(item)}`.trim()}
                  role="listitem"
                >
                  <div className="ops-mr-item__head">
                    <p className="ops-mr-item__title">{item.title || 'Untitled'}</p>
                    <ReviewStatus item={item} />
                  </div>
                  <p className="ops-mr-item__meta">
                    Category: {item.category || '—'}
                    {showSeverityText ? ` · Severity: ${item.severity || '—'}` : ''}
                  </p>
                  <p className="ops-mr-item__meta">
                    Target: {item.entityType || '—'} ·{' '}
                    <span className="ops-mr-item__ref">{item.entityId || '—'}</span>
                  </p>
                  {reservationHref ? (
                    <Link to={reservationHref} className="ops-mr-item__link">
                      Open reservation (guest message automation)
                    </Link>
                  ) : null}
                  {item.details ? <p className="ops-mr-item__details">{item.details}</p> : null}
                  {item.provenance ? (
                    <p className="ops-mr-item__meta">
                      Provenance: {item.provenance.source || '—'}{' '}
                      {item.provenance.sourceReference ? (
                        <span className="ops-mr-item__ref">({item.provenance.sourceReference})</span>
                      ) : (
                        ''
                      )}
                    </p>
                  ) : null}
                  {item.status === 'open' ? (
                    <div className="ops-mr-item__actions">
                      <ManualReviewResolveAction
                        manualReviewItemId={item.manualReviewItemId}
                        onResolved={() => load()}
                      />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </OpsSurface>
      )}
    </OpsPage>
  );
}
