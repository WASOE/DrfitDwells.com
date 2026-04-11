import { useEffect, useMemo, useState } from 'react';
import { fetchCabins } from '../services/cabinContent';

const PRIMARY_CABIN_NAMES = ['the cabin', 'bucephalus', 'the cabin (bucephalus)'];

function findPrimaryCabinId(nameToId) {
  for (const n of PRIMARY_CABIN_NAMES) {
    const id = nameToId[n];
    if (id) return id;
  }
  return null;
}

/**
 * Loads public cabins once (cached via fetchCabins) and exposes a lowercase name → _id map
 * for linking into CabinDetails / booking.
 */
export function useCabinNameToIdMap() {
  const [nameToId, setNameToId] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cabins = await fetchCabins();
        if (!active) return;
        const map = {};
        (cabins || []).forEach((c) => {
          if (c?.name && c?._id) map[c.name.trim().toLowerCase()] = c._id;
        });
        setNameToId(map);
      } catch {
        if (active) setNameToId({});
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const primaryCabinId = useMemo(() => findPrimaryCabinId(nameToId), [nameToId]);

  return { nameToId, primaryCabinId, loading };
}
