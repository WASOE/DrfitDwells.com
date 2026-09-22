import { useCallback, useEffect, useState } from 'react';
import { CLEANING_TAG_LABELS, CLEANING_TAG_VOCABULARY } from '../../../constants/cleaningTagVocabulary';
import {
  getCleaningInventoryTags,
  updateCabinCleaningTags,
  updateCabinTypeCleaningTags
} from '../../../services/cleaningApi';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsBadge from '../../../ops/primitives/OpsBadge';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsCheckbox from '../../../ops/primitives/OpsCheckbox';
import OpsInlineError from '../../../ops/primitives/OpsInlineError';
import OpsLoadingState from '../../../ops/primitives/OpsLoadingState';
import OpsSurface, {
  OpsSurfaceDescription,
  OpsSurfaceHeader,
  OpsSurfaceTitle
} from '../../../ops/primitives/OpsSurface';

function toggleTag(currentTags, tag) {
  const set = new Set(currentTags || []);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  return [...set];
}

function TagCheckboxGroup({ selectedTags, disabled, onChange, testIdPrefix }) {
  return (
    <div className="ops-cleaning-settings-tag-group">
      {CLEANING_TAG_VOCABULARY.map((tag) => (
        <OpsCheckbox
          key={tag}
          label={CLEANING_TAG_LABELS[tag] || tag}
          checked={selectedTags.includes(tag)}
          disabled={disabled}
          onChange={() => onChange(toggleTag(selectedTags, tag))}
          data-testid={`${testIdPrefix}-tag-${tag}`}
        />
      ))}
    </div>
  );
}

function InventoryRow({ row, canWrite, savingId, onSave }) {
  const [draftTags, setDraftTags] = useState(row.cleaningTags || []);
  const busy = savingId === row.id;

  useEffect(() => {
    setDraftTags(row.cleaningTags || []);
  }, [row.cleaningTags, row.id]);

  const dirty =
    JSON.stringify([...(draftTags || [])].sort()) !==
    JSON.stringify([...(row.cleaningTags || [])].sort());

  return (
    <div
      className={`ops-cleaning-settings-inventory-row${
        row.missingPricingTag ? ' ops-cleaning-settings-inventory-row--warn' : ''
      }`}
      data-testid={`inventory-row-${row.id}`}
    >
      <div className="ops-cleaning-settings-inventory-row__top">
        <div>
          <p className="ops-cleaning-settings-inventory-row__name">{row.name}</p>
          <p className="ops-cleaning-settings-inventory-row__meta">
            {row.kind === 'cabin_type' ? 'Multi-unit type' : 'Single cabin'} · {row.propertyKind}
          </p>
        </div>
        {row.missingPricingTag ? <OpsBadge tone="neutral">Missing pricing tag</OpsBadge> : null}
      </div>
      <TagCheckboxGroup
        selectedTags={draftTags}
        disabled={!canWrite || busy}
        onChange={setDraftTags}
        testIdPrefix={`inventory-${row.id}`}
      />
      {canWrite && dirty ? (
        <OpsButton
          size="compact"
          loading={busy}
          loadingLabel="Saving…"
          onClick={() => onSave(row, draftTags)}
          data-testid={`save-tags-${row.id}`}
        >
          Save tags
        </OpsButton>
      ) : null}
    </div>
  );
}

export default function OpsCleaningInventoryTagsPanel({ canWrite }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterKind, setFilterKind] = useState('valley');
  const [savingId, setSavingId] = useState(null);
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getCleaningInventoryTags();
      setData(res.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load inventory tags.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (row, cleaningTags) => {
    setSavingId(row.id);
    setSaveError('');
    try {
      const updater =
        row.kind === 'cabin_type' ? updateCabinTypeCleaningTags : updateCabinCleaningTags;
      await updater(row.id, cleaningTags);
      await load();
    } catch (err) {
      setSaveError(err?.response?.data?.message || 'Failed to save tags.');
    } finally {
      setSavingId(null);
    }
  };

  const filtered = (data?.inventory || []).filter((row) => row.propertyKind === filterKind);

  return (
    <OpsSurface className="ops-cleaning-settings-surface" aria-labelledby="ops-cleaning-inventory-title">
      <OpsSurfaceHeader className="ops-cleaning-settings-surface__head">
        <div>
          <OpsSurfaceTitle id="ops-cleaning-inventory-title" className="ops-cleaning-settings-surface__title">
            Inventory cleaning tags
          </OpsSurfaceTitle>
          <OpsSurfaceDescription className="ops-cleaning-settings-surface__desc">
            Tag each bookable unit so checkout-driven rules can match. Only controlled tags are stored.
          </OpsSurfaceDescription>
        </div>
      </OpsSurfaceHeader>

      {data?.untaggedValleyCount > 0 ? (
        <div data-testid="untagged-valley-banner">
          <OpsBanner
            tone="warning"
            title={`${data.untaggedValleyCount} Valley ${
              data.untaggedValleyCount === 1 ? 'unit has' : 'units have'
            } no pricing tag`}
            body="Untagged Valley checkouts will not match A-frame, lux, or house rules — only laundry and transport will apply."
          />
          {data.untaggedValley?.length ? (
            <ul className="ops-cleaning-settings-banner-list">
              {data.untaggedValley.slice(0, 8).map((row) => (
                <li key={row.id}>{row.name}</li>
              ))}
              {data.untaggedValley.length > 8 ? (
                <li>…and {data.untaggedValley.length - 8} more</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {data?.untaggedCabinCount > 0 ? (
        <div data-testid="untagged-cabin-banner">
          <OpsBanner
            tone="warning"
            title={`${data.untaggedCabinCount} Cabin ${
              data.untaggedCabinCount === 1 ? 'unit has' : 'units have'
            } no pricing tag`}
            body="Untagged Cabin checkouts will not match cabin cleaning rules — only transport will apply when checkouts exist."
          />
        </div>
      ) : null}

      <div className="ops-cleaning-settings-filters">
        {['valley', 'cabin'].map((kind) => (
          <OpsButton
            key={kind}
            type="button"
            size="compact"
            variant={filterKind === kind ? 'primary' : 'secondary'}
            onClick={() => setFilterKind(kind)}
            data-testid={`filter-${kind}`}
          >
            {kind === 'valley' ? 'The Valley' : 'The Cabin'}
          </OpsButton>
        ))}
      </div>

      {loading ? <OpsLoadingState label="Loading inventory…" /> : null}
      {error ? <OpsInlineError>{error}</OpsInlineError> : null}
      {saveError ? <OpsInlineError>{saveError}</OpsInlineError> : null}

      {!loading && !error ? (
        <div className="ops-cleaning-settings-inventory-grid">
          {filtered.length === 0 ? (
            <p className="ops-cleaning-settings-empty">No inventory for this location.</p>
          ) : (
            filtered.map((row) => (
              <InventoryRow
                key={row.id}
                row={row}
                canWrite={canWrite}
                savingId={savingId}
                onSave={handleSave}
              />
            ))
          )}
        </div>
      ) : null}
    </OpsSurface>
  );
}
