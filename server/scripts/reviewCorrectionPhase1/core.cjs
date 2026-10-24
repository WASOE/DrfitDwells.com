'use strict';

const crypto = require('node:crypto');

const CABIN = '69b2ff933a7fff6621e785cc';
const POOLS = [
  { name: 'The Cabin', id: CABIN, count: 130, synthetic: 0 },
  { name: 'A-Frame', id: '69b2ff947f141a71ffa7c401', linked: '69d096b6bd7fb6fc0d3c2a34', synthetic: 110 },
  { name: 'Stone House', id: '69b2ff947f141a71ffa7c452', synthetic: 97 },
  { name: 'Lux Cabin', id: '69b2ff947f141a71ffa7c492', synthetic: 150 }
];
const EVIDENCE_HASHES = {
  // Pinned to the read-only 22 October audit; never accept a substituted inventory.
  inventory: 'df6e159803925bb268e1ecdfba68e53e9978dfd52c23e1c1c3365601fea1fd4f',
  snapshot: 'f86e6d7ce059fe057757ca0e70388a7ca0d1af75771f3d479e0b4fde5ad546bc'
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(
    typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value))
  ).digest('hex');
}

function id(value) {
  return String(value);
}

function evidence(inventoryBytes, snapshotBytes) {
  assert(hash(inventoryBytes) === EVIDENCE_HASHES.inventory, 'Inventory file hash mismatch');
  assert(hash(snapshotBytes) === EVIDENCE_HASHES.snapshot, 'Public snapshot file hash mismatch');
  const ids = [...inventoryBytes.toString().matchAll(/^([a-f0-9]{24}),[a-f0-9]{24},manual-/gm)]
    .map(match => match[1]);
  assert(ids.length === 357 && new Set(ids).size === 357, 'Expected exactly 357 unique inventory IDs');
  const all = new Map();
  for (const pool of JSON.parse(snapshotBytes)) {
    for (const review of pool.reviews) {
      if (all.has(review._id)) {
        assert(hash(all.get(review._id)) === hash(review), 'Conflicting duplicated public record');
      }
      all.set(review._id, review);
    }
  }
  const synthetic = ids.map(key => {
    assert(all.has(key), 'Inventory ID missing from pinned snapshot');
    return all.get(key);
  });
  for (const pool of POOLS.filter(pool => pool.synthetic)) {
    const rows = synthetic.filter(row => row.cabinId === pool.id);
    assert(rows.length === pool.synthetic, `Inventory pool mismatch: ${pool.name}`);
    const slug = { 'A-Frame': 'a-frame', 'Stone House': 'stone-house', 'Lux Cabin': 'lux-cabin' }[pool.name];
    const indexes = rows.map(row => {
      const match = row.externalId.match(new RegExp(`^manual-${slug}-17733420068\\d{2}-(\\d+)$`));
      assert(match && row.source === 'manual', 'Synthetic provenance mismatch');
      const timestamp = Date.parse(row.createdAt);
      assert(timestamp >= Date.parse('2026-03-12T19:00:06.867Z') &&
        timestamp <= Date.parse('2026-03-12T19:00:07.150Z'), 'Creation window mismatch');
      return Number(match[1]);
    }).sort((a, b) => a - b);
    assert(indexes.every((value, index) => value === index), 'Incomplete generator sequence');
  }
  return { synthetic, cabin: [...all.values()].filter(row => row.cabinId === CABIN) };
}

function documentsHash(rows, encode) {
  return hash(rows.map(row => [id(row._id), encode(row)]).sort(([a], [b]) => a.localeCompare(b)));
}

function snapshotHash(state, encode) {
  return hash(Object.fromEntries(['reviews', 'cabins', 'cabinTypes'].map(
    key => [key, documentsHash(state[key], encode)]
  )));
}

function publicMatch(current, expected) {
  const actual = JSON.parse(JSON.stringify(current));
  // Compare every public snapshot field; private/native BSON fields remain intact in the backup.
  for (const [key, value] of Object.entries(expected)) {
    const field = actual[key];
    assert(hash(field === undefined ? null : field) === hash(value), `Public fingerprint drift: ${expected._id}/${key}`);
  }
}

function publication(rows, owners, minRating = 2) {
  return rows.filter(row => owners.includes(id(row.cabinId)) && row.status === 'approved' &&
    row.deletedAt == null && row.rating >= minRating);
}

function resolveOwners(state, pool) {
  const type = state.cabinTypes.find(row => id(row._id) === pool.id);
  if (!type) {
    const cabin = state.cabins.find(row => id(row._id) === pool.id);
    assert(cabin, `Missing owner: ${pool.name}`);
    assert(!(cabin.cabinTypeId && (cabin.inventoryType === 'multi' || cabin.inventoryMode === 'multi')),
      `Unexpected multi-unit ownership: ${pool.name}`);
    return [pool.id];
  }
  return [pool.id, ...state.cabins.filter(row =>
    id(row.cabinTypeId) === pool.id || id(row.cabinTypeRef) === pool.id).map(row => id(row._id))];
}

function prepare(before, audit, encode, clone) {
  const reviewMap = new Map(before.reviews.map(row => [id(row._id), row]));
  const syntheticIds = new Set(audit.synthetic.map(row => row._id));
  assert(audit.cabin.length === 130, 'Pinned Cabin inventory must contain 130 records');
  const cabinRows = before.reviews.filter(row => id(row.cabinId) === CABIN);
  assert(cabinRows.length === 130, 'Cabin inventory drift; all statuses must total exactly 130');
  for (const row of [...audit.synthetic, ...audit.cabin]) {
    assert(reviewMap.has(row._id), `Missing inventoried record: ${row._id}`);
    publicMatch(reviewMap.get(row._id), row);
  }
  const after = clone(before);
  after.reviews = after.reviews.filter(row => !syntheticIds.has(id(row._id)));
  const report = [];
  for (const pool of POOLS) {
    const owners = resolveOwners(before, pool);
    assert(hash([...owners].sort()) === hash([pool.id, ...(pool.linked ? [pool.linked] : [])].sort()),
      `Resolved owners differ from explicit allowlist: ${pool.name}`);
    if (pool.linked) {
      assert(owners.includes(pool.linked), 'A-Frame linked ownership drift');
      const linked = before.cabins.find(row => id(row._id) === pool.linked);
      assert(id(linked.cabinTypeId) === pool.id &&
        (linked.inventoryType === 'multi' || linked.inventoryMode === 'multi'), 'A-Frame reverse ownership drift');
    }
    // Additional public feedback requires evidence assessment, not automatic certification or removal.
    const known = new Set([...audit.synthetic, ...audit.cabin].map(row => row._id));
    assert(publication(before.reviews, owners, 1).every(row => known.has(id(row._id))),
      `Additional published records require review: ${pool.name}`);
    const published = publication(after.reviews, owners);
    const allRatings = publication(after.reviews, owners, 1);
    assert(published.length === allRatings.length, `Publication/statistics rating threshold conflict: ${pool.name}`);
    const sum = published.reduce((total, row) => total + row.rating, 0);
    const mean = published.length ? sum / published.length : null;
    const stats = { reviewsCount: published.length, averageRating: mean === null ? 0 : Math.round(mean * 10) / 10 };
    for (const collection of ['cabins', 'cabinTypes']) {
      for (const row of after[collection].filter(row => owners.includes(id(row._id)))) Object.assign(row, stats);
    }
    report.push({
      name: pool.name, ownerIds: owners, archiveCount: pool.synthetic, count: published.length,
      ratingSum: sum, exactMean: mean, storedMean: stats.averageRating,
      provenance: pool.id === CABIN ? 'Preserved import; NOT independently verified Airbnb originals' : 'No verified replacements supplied'
    });
  }
  const archive = before.reviews.filter(row => syntheticIds.has(id(row._id)));
  assert(archive.length === 357, 'Archive must contain exactly 357 full documents');
  assert(documentsHash(cabinRows, encode) === documentsHash(after.reviews.filter(row => id(row.cabinId) === CABIN), encode),
    'Cabin document preservation failed');
  return { after, archive, report, cabinHash: documentsHash(cabinRows, encode) };
}

module.exports = { CABIN, POOLS, EVIDENCE_HASHES, assert, hash, evidence, documentsHash, snapshotHash, prepare };
