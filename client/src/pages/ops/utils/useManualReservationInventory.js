import { useEffect, useState } from 'react';
import { cabinAPI, unitAPI } from '../../../services/api';
import { opsReadAPI } from '../../../services/opsApi';
import { blockBoundaryDateOnly, resolveSofiaDateOnly } from '../calendar/opsCalendarDateUtils';

export function unitAvailability(unit, blocks, checkIn, checkOut) {
  if (!checkIn || !checkOut || checkOut <= checkIn) return 'Select dates';
  const overlaps = blocks.filter((block) =>
    (!block.unitId || String(block.unitId) === String(unit._id)) &&
    block.status === 'active' &&
    blockBoundaryDateOnly(block, 'start') < checkOut &&
    blockBoundaryDateOnly(block, 'end') > checkIn
  );
  if (overlaps.some((block) => block.blockType === 'reservation')) return 'Occupied';
  const blocked = (unit.blockedDates || []).some((date) => {
    const day = resolveSofiaDateOnly(null, date);
    return day >= checkIn && day < checkOut;
  });
  return blocked || overlaps.length ? 'Unavailable' : 'Available';
}

// Use canonical Cabin inventory metadata, not the Ops list's presentation kind.
export default function useManualReservationInventory(open, form) {
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState('');
  const [inventory, setInventory] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalog(null);
    setCatalogError('');
    cabinAPI.getAll().then((response) => {
      const cabins = response.data?.data?.cabins;
      if (!Array.isArray(cabins)) throw new Error('Invalid accommodation response');
      if (!cancelled) setCatalog(cabins.filter((cabin) => cabin.isActive !== false && !cabin.archivedAt));
    }).catch((error) => {
      if (!cancelled) setCatalogError(error?.response?.data?.message || error.message || 'Failed to load accommodations');
    });
    return () => { cancelled = true; };
  }, [open, retry]);

  const selected = catalog?.find((cabin) => String(cabin._id) === form.cabinId);
  const isMulti = selected?.inventoryType === 'multi';
  const typeRef = selected?.cabinTypeId || selected?.cabinTypeRef;
  const typeId = typeof typeRef === 'object' ? typeRef?._id : typeRef;
  const key = JSON.stringify([form.cabinId, typeId, form.checkIn, form.checkOut, retry]);
  const validDates = Boolean(form.checkIn && form.checkOut && form.checkOut > form.checkIn);

  useEffect(() => {
    if (!open || !isMulti || !typeId) return;
    let cancelled = false;
    Promise.all([
      unitAPI.getByCabinType(typeId),
      validDates
        ? opsReadAPI.calendar({ cabinId: typeId, from: form.checkIn, to: form.checkOut })
        : Promise.resolve(null)
    ]).then(([unitResponse, calendarResponse]) => {
      const units = unitResponse.data?.data?.units;
      const blocks = calendarResponse?.data?.data?.blocks;
      if (!Array.isArray(units) || (validDates && !Array.isArray(blocks))) {
        throw new Error('Invalid unit availability response');
      }
      if (!cancelled) setInventory({
        key,
        units: units.filter((unit) => unit.isActive === true && String(unit.cabinTypeId) === String(typeId)),
        blocks: blocks || []
      });
    }).catch((error) => {
      if (!cancelled) setInventory({
        key, error: error?.response?.data?.message || error.message || 'Failed to load unit availability'
      });
    });
    return () => { cancelled = true; };
  }, [open, isMulti, typeId, form.checkIn, form.checkOut, validDates, key]);

  const current = inventory?.key === key ? inventory : null;
  const units = (current?.units || []).map((unit) => ({
    ...unit,
    availability: unitAvailability(unit, current.blocks, form.checkIn, form.checkOut)
  }));
  const ready = Boolean(selected && validDates && (isMulti
    ? String(typeId) === form.cabinTypeId &&
      units.some((unit) => String(unit._id) === form.unitId && unit.availability === 'Available')
    : !form.unitId && !form.cabinTypeId));
  return {
    catalog, selected, isMulti, typeId, units, ready,
    loading: (!catalog && !catalogError) || (isMulti && !current && Boolean(typeId)),
    error: catalogError ||
      (catalog && form.cabinId && !selected ? 'Selected accommodation is not active or bookable' : '') ||
      (isMulti && !typeId ? 'Accommodation has no cabin type configured' : current?.error),
    reload: () => setRetry((value) => value + 1)
  };
}
