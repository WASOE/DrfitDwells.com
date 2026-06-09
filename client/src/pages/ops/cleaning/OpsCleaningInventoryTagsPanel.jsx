import { useCallback, useEffect, useState } from 'react';
import { CLEANING_TAG_LABELS, CLEANING_TAG_VOCABULARY } from '../../../constants/cleaningTagVocabulary';
import {
  getCleaningInventoryTags,
  updateCabinCleaningTags,
  updateCabinTypeCleaningTags
} from '../../../services/cleaningApi';

function toggleTag(currentTags, tag) {
  const set = new Set(currentTags || []);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  return [...set];
}

function TagCheckboxGroup({ selectedTags, disabled, onChange, testIdPrefix }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CLEANING_TAG_VOCABULARY.map((tag) => (
        <label
          key={tag}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
            disabled ? 'opacity-60' : 'cursor-pointer'
          } ${selectedTags.includes(tag) ? 'border-[#81887A] bg-[#81887A]/10' : 'border-gray-200'}`}
        >
          <input
            type="checkbox"
            checked={selectedTags.includes(tag)}
            disabled={disabled}
            onChange={() => onChange(toggleTag(selectedTags, tag))}
            data-testid={`${testIdPrefix}-tag-${tag}`}
          />
          <span>{CLEANING_TAG_LABELS[tag] || tag}</span>
        </label>
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
      className={`rounded-lg border px-3 py-3 ${
        row.missingPricingTag ? 'border-amber-300 bg-amber-50/60' : 'border-gray-200 bg-white'
      }`}
      data-testid={`inventory-row-${row.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">{row.name}</p>
          <p className="text-xs text-gray-500">
            {row.kind === 'cabin_type' ? 'Multi-unit type' : 'Single cabin'} · {row.propertyKind}
          </p>
        </div>
        {row.missingPricingTag ? (
          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
            No pricing tag
          </span>
        ) : null}
      </div>
      <div className="mt-3">
        <TagCheckboxGroup
          selectedTags={draftTags}
          disabled={!canWrite || busy}
          onChange={setDraftTags}
          testIdPrefix={`inventory-${row.id}`}
        />
      </div>
      {canWrite && dirty ? (
        <button
          type="button"
          onClick={() => onSave(row, draftTags)}
          disabled={busy}
          className="mt-3 rounded-md bg-[#81887A] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          data-testid={`save-tags-${row.id}`}
        >
          {busy ? 'Saving…' : 'Save tags'}
        </button>
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
    <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
      <div className="max-w-4xl">
        <h3 className="text-base font-semibold text-gray-900 md:text-lg">Inventory cleaning tags</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Tag each bookable unit so checkout-driven rules can match. Only controlled tags are stored.
        </p>
      </div>

      {data?.untaggedValleyCount > 0 ? (
        <div
          className="mt-4 max-w-4xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="untagged-valley-banner"
        >
          <p className="font-semibold">
            {data.untaggedValleyCount} Valley {data.untaggedValleyCount === 1 ? 'unit has' : 'units have'} no
            pricing tag
          </p>
          <p className="mt-1 text-amber-800">
            Untagged Valley checkouts will not match A-frame, lux, or house rules — only laundry and transport
            will apply.
          </p>
          {data.untaggedValley?.length ? (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
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

      <div className="mt-4 flex flex-wrap gap-2">
        {['valley', 'cabin'].map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setFilterKind(kind)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              filterKind === kind
                ? 'bg-gray-900 text-white'
                : 'border border-gray-300 bg-white text-gray-700'
            }`}
            data-testid={`filter-${kind}`}
          >
            {kind === 'valley' ? 'The Valley' : 'The Cabin'}
          </button>
        ))}
      </div>

      {loading ? <p className="mt-4 text-sm text-gray-400">Loading inventory…</p> : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      {saveError ? <p className="mt-4 text-sm text-red-600">{saveError}</p> : null}

      {!loading && !error ? (
        <div className="mt-4 grid max-w-4xl grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500">No inventory for this location.</p>
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
    </section>
  );
}
