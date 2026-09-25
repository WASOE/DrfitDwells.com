import { useEffect, useMemo, useState } from 'react';
import { pricingOverridesAPI, ratePlanAdminAPI } from '../../services/api';

function exclusiveEndDate(inclusiveEndDate) {
  if (!inclusiveEndDate) return inclusiveEndDate;
  const date = new Date(`${inclusiveEndDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export default function OpsPricingCalendar() {
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState({
    ratePlanCode: '',
    ratePlanVersion: '',
    startDate: '',
    endDate: '',
    priceCents: '',
    accommodations: []
  });
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ratePlanAdminAPI.list({ status: 'active', type: 'seasonal_stay' })
      .then((response) => setPlans(response.data?.data?.ratePlans || response.data?.ratePlans || []))
      .catch(() => setError('Unable to load active RatePlans'));
  }, []);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === form.ratePlanCode && Number(plan.version) === Number(form.ratePlanVersion)),
    [plans, form.ratePlanCode, form.ratePlanVersion]
  );

  useEffect(() => {
    if (!selectedPlan) return;
    setForm((current) => ({
      ...current,
      accommodations: (selectedPlan.accommodations || []).map(({ entityType, accommodationKey }) => ({
        entityType,
        accommodationKey
      }))
    }));
  }, [selectedPlan]);

  const load = async () => {
    setError('');
    setBusy(true);
    try {
      const calendarParams = { ...form };
      delete calendarParams.accommodations;
      delete calendarParams.priceCents;
      calendarParams.endDate = exclusiveEndDate(calendarParams.endDate);
      const response = await pricingOverridesAPI.calendar(calendarParams);
      setCalendar(response.data?.data || response.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load pricing calendar');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      await pricingOverridesAPI.saveRange({ ...form, endDate: exclusiveEndDate(form.endDate) });
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save overrides');
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm('Clear nightly overrides for this range?')) return;
    setError('');
    setBusy(true);
    try {
      await pricingOverridesAPI.clearRange({ ...form, endDate: exclusiveEndDate(form.endDate) });
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to clear overrides');
      setBusy(false);
    }
  };

  return (
    <main className="ops-page">
      <h1>Pricing Calendar</h1>
      {error && <div role="alert">{error}</div>}
      <section aria-label="Pricing calendar controls">
        <label>RatePlan
          <select value={`${form.ratePlanCode}:${form.ratePlanVersion}`} onChange={(event) => {
            const [ratePlanCode, ratePlanVersion] = event.target.value.split(':');
            setForm((current) => ({ ...current, ratePlanCode, ratePlanVersion }));
          }}>
            <option value="">Select a RatePlan</option>
            {plans.map((plan) => (
              <option key={`${plan.code}:${plan.version}`} value={`${plan.code}:${plan.version}`}>
                {plan.code} v{plan.version} — {plan.internalName || plan.name || ''}
              </option>
            ))}
          </select>
        </label>
        <label>From <input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
        <label>Through <input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>
        <label>Override price (EUR cents) <input type="number" min="1" step="1" value={form.priceCents} onChange={(event) => setForm({ ...form, priceCents: event.target.value })} /></label>
        <button type="button" disabled={busy} onClick={load}>Load</button>
        <button type="button" disabled={busy} onClick={save}>Save range</button>
        <button type="button" disabled={busy} onClick={clear}>Clear range</button>
      </section>
      {calendar && (
        <table>
          <thead><tr><th>Date</th><th>Accommodation</th><th>Base (EUR cents)</th><th>Override</th><th>Effective</th></tr></thead>
          <tbody>
            {calendar.nights.map((night) => (
              <tr key={`${night.date}:${night.entityType}:${night.accommodationKey}`}>
                <td>{night.date}</td>
                <td>{night.accommodationKey}</td>
                <td>{night.basePriceCents}</td>
                <td>{night.overridePriceCents ?? '—'}</td>
                <td>{night.effectivePriceCents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
