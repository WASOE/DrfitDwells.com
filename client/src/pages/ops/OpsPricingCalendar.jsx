import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, RotateCcw } from 'lucide-react';
import { pricingOverridesAPI, ratePlanAdminAPI } from '../../services/api';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsSelect from '../../ops/primitives/OpsSelect';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsSheet from '../../ops/primitives/OpsSheet';
import OpsSurface, {
  OpsSurfaceDescription,
  OpsSurfaceHeader,
  OpsSurfaceTitle
} from '../../ops/primitives/OpsSurface';
import './OpsPricingCalendar.css';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthRange(value) {
  const [year, month] = value.split('-').map(Number);
  return {
    year,
    month: month - 1,
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year + (month === 12 ? 1 : 0)}-${pad(month === 12 ? 1 : month + 1)}-01`
  };
}

export function exclusiveEndDate(inclusiveEndDate) {
  if (!inclusiveEndDate) return inclusiveEndDate;
  const date = new Date(`${inclusiveEndDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function dateLabel(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return {
    weekday: parsed.toLocaleDateString('en-US', { weekday: 'short' }),
    day: parsed.getUTCDate()
  };
}

function datesForMonth(value) {
  const { year, month } = monthRange(value);
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${year}-${pad(month + 1)}-${pad(index + 1)}`);
}

function displayAccommodationName(key) {
  return String(key || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eurosFromCents(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return '—';
  const euros = Number(cents) / 100;
  return `€${euros.toLocaleString('en-IE', {
    minimumFractionDigits: euros % 1 ? 2 : 0,
    maximumFractionDigits: 2
  })}`;
}

function planStartMonth(plan) {
  return plan?.arrivalWindowStart ? String(plan.arrivalWindowStart).slice(0, 7) : monthValue();
}

function nightIdentity(night) {
  return `${night.entityType}:${night.accommodationKey}:${night.date}`;
}

function accommodationIdentity(row) {
  return `${row.entityType}:${row.accommodationKey}`;
}

export default function OpsPricingCalendar() {
  const [plans, setPlans] = useState([]);
  const [selectedPlanKey, setSelectedPlanKey] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(monthValue());
  const [selectedAccommodations, setSelectedAccommodations] = useState([]);
  const [calendar, setCalendar] = useState(null);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState({
    startDate: '',
    endDate: '',
    accommodations: [],
    priceEuros: ''
  });
  const [busy, setBusy] = useState(false);

  const selectedPlan = useMemo(
    () => plans.find((plan) => `${plan.code}:${plan.version}` === selectedPlanKey),
    [plans, selectedPlanKey]
  );

  const planAccommodations = useMemo(
    () => (selectedPlan?.accommodations || []).map(({ accommodationKey, entityType }) => ({
      accommodationKey,
      entityType,
      identity: accommodationIdentity({ accommodationKey, entityType })
    })),
    [selectedPlan]
  );

  const loadCalendar = useCallback(async () => {
    if (!selectedPlan) return;
    setLoadingCalendar(true);
    setError('');
    try {
      const range = monthRange(selectedMonth);
      const response = await pricingOverridesAPI.calendar({
        ratePlanCode: selectedPlan.code,
        ratePlanVersion: selectedPlan.version,
        startDate: range.startDate,
        endDate: range.endDate
      });
      setCalendar(response.data?.data || response.data);
    } catch (requestError) {
      setCalendar(null);
      setError(requestError.response?.data?.message || 'Unable to load pricing calendar');
    } finally {
      setLoadingCalendar(false);
    }
  }, [selectedMonth, selectedPlan]);

  useEffect(() => {
    ratePlanAdminAPI.list({ status: 'active', type: 'seasonal_stay' })
      .then((response) => setPlans(response.data?.data?.ratePlans || response.data?.ratePlans || []))
      .catch(() => setError('Unable to load active RatePlans'))
      .finally(() => setLoadingPlans(false));
  }, []);

  useEffect(() => {
    if (!selectedPlan) {
      setSelectedAccommodations([]);
      setCalendar(null);
      return;
    }
    setSelectedAccommodations(planAccommodations.map((row) => row.identity));
    loadCalendar();
  }, [loadCalendar, planAccommodations, selectedPlan]);

  const calendarDates = useMemo(() => datesForMonth(selectedMonth), [selectedMonth]);
  const nightsByIdentity = useMemo(() => {
    const map = new Map();
    (calendar?.nights || []).forEach((night) => map.set(nightIdentity(night), night));
    return map;
  }, [calendar]);

  function choosePlan(value) {
    const plan = plans.find((candidate) => `${candidate.code}:${candidate.version}` === value);
    setSelectedPlanKey(value);
    setSelectedMonth(planStartMonth(plan));
    setNotice('');
  }

  function toggleAccommodation(identity) {
    setSelectedAccommodations((current) =>
      current.includes(identity)
        ? current.filter((value) => value !== identity)
        : [...current, identity]
    );
  }

  function shiftMonth(amount) {
    const date = new Date(`${selectedMonth}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setSelectedMonth(monthValue(date));
  }

  function openEditor(date = calendarDates[0], identity = selectedAccommodations[0]) {
    setNotice('');
    setEditor({
      startDate: date,
      endDate: date,
      accommodations: identity ? [identity] : selectedAccommodations,
      priceEuros: ''
    });
    setEditorOpen(true);
  }

  function updateEditor(key, value) {
    setEditor((current) => ({ ...current, [key]: value }));
  }

  function editorPayload() {
    return {
      ratePlanCode: selectedPlan.code,
      ratePlanVersion: selectedPlan.version,
      startDate: editor.startDate,
      endDate: exclusiveEndDate(editor.endDate),
      accommodations: editor.accommodations.map((identity) => {
        const row = planAccommodations.find((candidate) => candidate.identity === identity);
        return { accommodationKey: row.accommodationKey, entityType: row.entityType };
      }),
      priceCents: Math.round(Number(editor.priceEuros) * 100)
    };
  }

  async function saveOverride() {
    if (!editor.startDate || !editor.endDate || !editor.accommodations.length || Number(editor.priceEuros) <= 0) {
      setError('Choose a date range, at least one accommodation, and a positive nightly price.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await pricingOverridesAPI.saveRange(editorPayload());
      setEditorOpen(false);
      setNotice('Nightly override saved.');
      await loadCalendar();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save nightly override');
    } finally {
      setBusy(false);
    }
  }

  async function clearOverride() {
    if (!editor.startDate || !editor.endDate || !editor.accommodations.length) {
      setError('Choose a date range and at least one accommodation.');
      return;
    }
    const start = new Date(`${editor.startDate}T00:00:00Z`);
    const end = new Date(`${editor.endDate}T00:00:00Z`);
    const nights = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const message = `Clear nightly overrides for ${nights} night${nights === 1 ? '' : 's'} across ${editor.accommodations.length} accommodation${editor.accommodations.length === 1 ? '' : 's'}?\nBase RatePlan pricing will apply again.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError('');
    try {
      const payload = editorPayload();
      delete payload.priceCents;
      await pricingOverridesAPI.clearRange(payload);
      setEditorOpen(false);
      setNotice('Overrides cleared. Base RatePlan pricing applies again.');
      await loadCalendar();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to clear nightly override');
    } finally {
      setBusy(false);
    }
  }

  const headerMeta = selectedPlan ? (
    <span className="ops-pricing-calendar__plan-meta">
      {selectedPlan.code}@v{selectedPlan.version}
    </span>
  ) : null;

  return (
    <OpsPage width="full" className="ops-pricing-calendar" data-testid="ops-pricing-calendar">
      <OpsPageHeader
        title="Pricing Calendar"
        description="Manage nightly price overrides without changing the underlying RatePlan."
        meta={headerMeta}
        actions={selectedPlan ? (
          <OpsButton onClick={() => openEditor()}><Pencil size={16} aria-hidden="true" /> Edit range</OpsButton>
        ) : null}
      />

      {error ? <OpsBanner tone="danger" title="Pricing calendar unavailable" body={error} /> : null}
      {notice ? <OpsBanner tone="success" body={notice} /> : null}

      <OpsSurface className="ops-pricing-calendar__toolbar" aria-label="Pricing calendar filters">
        <OpsSelect
          id="pricing-calendar-rate-plan"
          label="RatePlan"
          value={selectedPlanKey}
          onChange={(event) => choosePlan(event.target.value)}
          disabled={loadingPlans}
          hint={selectedPlan ? `${selectedPlan.internalName || selectedPlan.code} · exact version ${selectedPlan.version}` : 'Choose an active seasonal RatePlan'}
        >
          <option value="">{loadingPlans ? 'Loading RatePlans…' : 'Select a RatePlan'}</option>
          {plans.map((plan) => (
            <option key={`${plan.code}:${plan.version}`} value={`${plan.code}:${plan.version}`}>
              {plan.internalName || plan.code} · v{plan.version}
            </option>
          ))}
        </OpsSelect>
        <div className="ops-pricing-calendar__month-control">
          <span className="ops-field-label">Month</span>
          <div className="ops-pricing-calendar__month-nav">
            <OpsButton variant="quiet" size="compact" aria-label="Previous month" onClick={() => shiftMonth(-1)} disabled={!selectedPlan}>
              <ChevronLeft size={16} aria-hidden="true" />
            </OpsButton>
            <strong aria-live="polite">{MONTHS[monthRange(selectedMonth).month]} {monthRange(selectedMonth).year}</strong>
            <OpsButton variant="quiet" size="compact" aria-label="Next month" onClick={() => shiftMonth(1)} disabled={!selectedPlan}>
              <ChevronRight size={16} aria-hidden="true" />
            </OpsButton>
          </div>
        </div>
        {selectedPlan ? (
          <div className="ops-pricing-calendar__accommodation-filter">
            <span className="ops-field-label">Accommodations</span>
            <div className="ops-pricing-calendar__filter-list">
              {planAccommodations.map((row) => (
                <label key={row.identity} className="ops-pricing-calendar__filter-option">
                  <input
                    type="checkbox"
                    checked={selectedAccommodations.includes(row.identity)}
                    onChange={() => toggleAccommodation(row.identity)}
                  />
                  {displayAccommodationName(row.accommodationKey)}
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </OpsSurface>

      {!selectedPlan ? (
        <OpsSurface className="ops-pricing-calendar__empty">
          <OpsEmptyState
            title="Select a RatePlan to view nightly pricing"
            body="Choose an active seasonal RatePlan above to load its base and override prices by night."
          />
        </OpsSurface>
      ) : loadingCalendar ? (
        <OpsSurface><OpsLoadingState label="Loading nightly prices…" /></OpsSurface>
      ) : (
        <OpsSurface className="ops-pricing-calendar__grid-surface">
          <OpsSurfaceHeader>
            <div>
              <OpsSurfaceTitle>{selectedPlan.internalName || selectedPlan.code}</OpsSurfaceTitle>
              <OpsSurfaceDescription>Base prices come from the selected RatePlan. Overrides apply only to the highlighted nights.</OpsSurfaceDescription>
            </div>
            <OpsButton variant="secondary" size="compact" onClick={() => loadCalendar()}>
              <RotateCcw size={15} aria-hidden="true" /> Refresh
            </OpsButton>
          </OpsSurfaceHeader>
          <div className="ops-pricing-calendar__scroll" data-testid="pricing-calendar-grid">
            <div className="ops-pricing-calendar__grid" style={{ '--pricing-days': calendarDates.length }}>
              <div className="ops-pricing-calendar__corner">Accommodation</div>
              {calendarDates.map((date) => {
                const label = dateLabel(date);
                return <div className="ops-pricing-calendar__date" key={date}><span>{label.weekday}</span><strong>{label.day}</strong></div>;
              })}
              {planAccommodations
                .filter((row) => selectedAccommodations.includes(row.identity))
                .map((row) => (
                  <div className="ops-pricing-calendar__row" key={row.identity}>
                    <div className="ops-pricing-calendar__accommodation-name">
                      <strong>{displayAccommodationName(row.accommodationKey)}</strong>
                      <span>{row.entityType === 'cabinType' ? 'Accommodation type' : 'Cabin'}</span>
                    </div>
                    {calendarDates.map((date) => {
                      const night = nightsByIdentity.get(`${row.identity}:${date}`);
                      const hasOverride = night?.overridePriceCents != null;
                      return (
                        <button
                          className={`ops-pricing-calendar__cell${hasOverride ? ' ops-pricing-calendar__cell--override' : ''}`}
                          type="button"
                          key={date}
                          onClick={() => openEditor(date, row.identity)}
                          aria-label={`${displayAccommodationName(row.accommodationKey)} ${date} ${hasOverride ? 'override' : 'base'} ${eurosFromCents(night?.effectivePriceCents)}`}
                        >
                          <strong>{eurosFromCents(night?.effectivePriceCents)}</strong>
                          {hasOverride ? <span>was {eurosFromCents(night.basePriceCents)}</span> : <span>Base</span>}
                        </button>
                      );
                    })}
                  </div>
                ))}
            </div>
          </div>
          <p className="ops-pricing-calendar__hint">Select any date cell to edit a range. Dates in the editor are inclusive.</p>
        </OpsSurface>
      )}

      <OpsSheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        side="right"
        title="Edit nightly pricing"
        description="Set or clear a fixed nightly override. Through is inclusive."
        footer={(
          <div className="ops-pricing-calendar__editor-actions">
            <OpsButton variant="quiet" onClick={() => setEditorOpen(false)}>Cancel</OpsButton>
            <OpsButton variant="destructive" onClick={clearOverride} loading={busy}>Clear override</OpsButton>
            <OpsButton onClick={saveOverride} loading={busy}>Save override</OpsButton>
          </div>
        )}
      >
        <div className="ops-pricing-calendar__editor">
          <div className="ops-pricing-calendar__editor-grid">
            <OpsTextField id="pricing-from" label="From" type="date" value={editor.startDate} onChange={(event) => updateEditor('startDate', event.target.value)} />
            <OpsTextField id="pricing-through" label="Through" type="date" value={editor.endDate} onChange={(event) => updateEditor('endDate', event.target.value)} />
          </div>
          <OpsTextField
            id="pricing-price"
            label="Nightly price (€)"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            placeholder="110 or 145.50"
            value={editor.priceEuros}
            onChange={(event) => updateEditor('priceEuros', event.target.value)}
          />
          <fieldset className="ops-pricing-calendar__editor-accommodations">
            <legend className="ops-field-label">Accommodations</legend>
            {planAccommodations.map((row) => (
              <label key={row.identity} className="ops-pricing-calendar__editor-option">
                <input
                  type="checkbox"
                  checked={editor.accommodations.includes(row.identity)}
                  onChange={() => updateEditor(
                    'accommodations',
                    editor.accommodations.includes(row.identity)
                      ? editor.accommodations.filter((value) => value !== row.identity)
                      : [...editor.accommodations, row.identity]
                  )}
                />
                {displayAccommodationName(row.accommodationKey)}
              </label>
            ))}
          </fieldset>
          <p className="ops-pricing-calendar__editor-note">The selected price is stored as EUR cents internally. Existing RatePlan base pricing is never changed.</p>
        </div>
      </OpsSheet>
    </OpsPage>
  );
}
