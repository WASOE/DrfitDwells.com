export function listRowId(item) {
  if (item.kind === 'multi_unit_type') return `multi-${item.cabinTypeId}`;
  return `single-${item.cabinId}`;
}

export function listHref(item) {
  if (item.kind === 'multi_unit_type') return `/ops/cabins/${item.cabinTypeId}`;
  return `/ops/cabins/${item.cabinId}`;
}

export function thumbInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
  const out = `${a}${b}`.toUpperCase();
  return out || '—';
}

export function normalizeMediaSrc(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return url;
  return `/uploads/cabins/${url}`;
}

export const MEDIA_TAG_OPTIONS = [
  'bedroom',
  'living_room',
  'kitchen',
  'dining',
  'bathroom',
  'outdoor',
  'view',
  'hot_tub_sauna',
  'amenities',
  'floorplan',
  'map',
  'other'
];

export function formatDateOnlyForOps(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return m ? m[1] : value.slice(0, 10);
  }
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return String(value);
  }
}

export function normalizeExperienceKeySeed(name) {
  const source = String(name || '').trim().toLowerCase();
  if (!source) return '';
  const normalized = source.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized.slice(0, 40);
}

export function buildExperienceKey(name, usedKeys) {
  const timestamp = Date.now();
  const seed = normalizeExperienceKeySeed(name);
  const base = seed ? `exp_${seed}_${timestamp}` : `exp_${timestamp}`;
  let key = base;
  let suffix = 1;
  while (usedKeys.has(key)) {
    key = `${base}_${suffix++}`;
  }
  usedKeys.add(key);
  return key;
}
