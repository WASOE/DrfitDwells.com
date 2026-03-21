import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';

export function OpsCabinsList() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.cabins();
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load cabins');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="text-sm text-gray-500">Loading cabins...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">No cabins found.</div>;

  return (
    <div className="space-y-3 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Cabins</h2>
        <p className="text-sm text-gray-500 mt-1">Operational settings and media context (read-only).</p>
      </section>

      <div className="space-y-2">
        {data.items?.map((c) => (
          <Link key={c.cabinId} to={`/ops/cabins/${c.cabinId}`} className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-gray-50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{c.name}</div>
                <div className="text-xs text-gray-500 truncate">{c.location}</div>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{c.operational.capacity ?? '—'} guests</span>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{c.operational.minNights ?? '—'} min nights</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function OpsCabinDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.cabinDetail(id);
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load cabin');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="text-sm text-gray-500">Loading cabin...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">Cabin not found.</div>;

  const op = data.operationalSettings || {};
  const content = data.contentMedia || {};
  const pre = data.preArrival || {};
  const degraded = data.degraded || {};

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <Link to="/ops/cabins" className="text-sm text-[#81887A] hover:underline">
          Back to cabins
        </Link>
        <h2 className="mt-1 text-lg font-semibold text-gray-900">{data.cabinId}</h2>
        {degraded.missingGeo ? (
          <p className="mt-1 text-sm text-amber-800">Degraded: missing geo coordinates.</p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900">Operational settings</h3>
          <div className="mt-3 space-y-2 text-sm text-gray-700">
            <p>Capacity: {op.capacity ?? '—'}</p>
            <p>Min nights: {op.minNights ?? '—'}</p>
            <p>Price/night: {op.pricePerNight ?? '—'}</p>
            <p>Blocked dates count: {op.blockedDates?.length ?? 0}</p>
            <p>Transport options: {op.transportOptions?.length ?? 0}</p>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900">Content & media</h3>
          <div className="mt-3 space-y-2">
            {content.imageUrl ? (
              <img src={content.imageUrl} alt="" className="w-full max-w-md rounded-lg border border-gray-200" />
            ) : (
              <p className="text-sm text-gray-500">No cover image.</p>
            )}
            <p className="text-sm text-gray-700">Name: {content.name || '—'}</p>
            <p className="text-sm text-gray-700">Location: {content.location || '—'}</p>
            <p className="text-sm text-gray-600">Highlights: {content.highlights?.length ? content.highlights.join(', ') : '—'}</p>
          </div>
        </section>
      </div>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900">Pre-arrival configuration</h3>
        <div className="mt-3 space-y-2 text-sm text-gray-700">
          <p>Packing list items: {pre.packingList?.length ?? 0}</p>
          <p>Arrival guide URL: {pre.arrivalGuideUrl ? pre.arrivalGuideUrl : '—'}</p>
          <p>Emergency contact: {pre.emergencyContact ? pre.emergencyContact : '—'}</p>
        </div>
      </section>
    </div>
  );
}
