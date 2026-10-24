# Review correction: Phase 1 preparation

**Approval boundary:** a narrowly scoped, read-only production export was
completed. No production records were changed, no staging database was imported
or modified, and no deployment or merge was performed. The full private
production backup and real staging verification have not been run. The
correction/rollback tooling in this worktree is restricted to isolated loopback
MongoDB; it is not a production execution command. Any production write requires
separate final approval and an independently verified full backup.

## Scope and evidence

The pinned 22 October 2026 audit identifies 487 unique public records: 130 Cabin
imports and 357 generator records (A-Frame 110, Stone House 97, Lux Cabin 150).
The two A-Frame endpoints share one review pool, not 220 records. A separate
hidden Stone House review was detected outside the explicit inventory and was
not exported or modified.

`core.cjs` pins SHA-256 digests of the exact inventory and public snapshot. It
uses the 357 exact IDs, validates the complete generator sequences and
source/owner/external-ID/creation-window provenance, and compares every
available public snapshot field, including text, rating, identity, dates and the
edited Lux record. A broad `source=manual` predicate is never used.

No genuine replacements or original Airbnb export were supplied. No
testimonials are invented, copied across accommodations, rewritten, or upgraded.
Additional published records, changed fingerprints, changed Cabin inventory,
changed ownership, or state drift stop the operation for evidence review. All
130 Cabin review documents remain unchanged in local correction tests. The
Cabin 5.0 is a **preserved-import aggregate, not independently verified Airbnb
original scores or proof that the source export is complete**.

## Tool behavior

- `export.cjs` is read-only and uses the existing server configuration and
  `MONGODB_URI` / `MONGO_URI`. Production is standalone MongoDB: the exporter
  performs two complete, independently hashed reads of the exact allowlist and
  verifies deployment identity before and after. Matching reads are not a
  transactional or point-in-time snapshot. It reads only `reviews`, `cabins`
  and `cabintypes`: the 357 exact synthetic IDs, 130 Cabin-owned reviews, and
  five projected statistics/ownership documents. It excludes bookings,
  payments, guests, users, unrelated reviews and properties.
- The exporter aborts for missing, extra or changed inventory, mismatched read
  hashes, or changed deployment identity. Export artifacts and manifest are
  private mode `0600` under a mode `0700` directory. No credential or review
  text is printed. Transfer only through an approved encrypted operator channel.
- `run.cjs backup` is the separate full review/property backup path. It includes
  all review statuses, soft-deleted documents, raw/moderation fields and
  complete associated property documents, but no unrelated collections. Its
  pre-existing transaction-based backup command requires a replica set; it has
  not been run against production as part of this work.
- `standalone.cjs` is a local-only correction/rollback harness. It refuses
  non-loopback database URIs. The fixture is seeded from the verified export,
  archives exact full documents for the 357 allowlisted reviews, conditionally
  changes their status to `hidden`, and updates only the resolved property
  counters. It retains records in the collection, so the operation can be
  reversed. Per-document conditional updates and a durable, checksummed private
  journal support recovery after partial failures; no multi-document
  transaction or atomic snapshot is claimed.
- Cabin-type and linked Cabin counters are both accounted for. Means are
  computed from published eligible records, exact and one-decimal stored means
  are reported separately, and zero reviews use the existing `0` stored
  average sentinel. Genuine lower-rated feedback is not silently removed or
  certified based on a source flag.
- The synthetic generator entry point is retired and fails immediately without
  importing dependencies or connecting. Its review generation/deletion/stat
  mutation code has been removed. No repository launcher was found. Existing
  Airbnb processing/import scripts are unchanged and are not safe tools for
  reconciling Cabin ratings.

## Local verification (not staging)

The tests require the private pinned audit artifacts; they fail with guidance
if absent instead of skipping exact-ID checks or committing review text.
`standalone.test.cjs` additionally requires the private production export.

```sh
REVIEW_CORRECTION_AUDIT_DIR=/private/read-only/audit \
REVIEW_CORRECTION_PRODUCTION_EXPORT=/private/export/review-only-export-<sha256>.ejson \
  npm run test:review-correction-phase1 --prefix server
```

The suite uses ephemeral local MongoDB instances only. The standalone suite
loads the real verified export into an isolated local standalone MongoDB, injects
failures after a partial review hide, after a stats update, and during partial
rollback, then verifies resume/recovery. It checks exact inventory scope,
checksums, full 130-document Cabin fingerprint preservation, private archival,
property counters, and that a hidden non-target test fixture survives unchanged.
No staging or production connection is made by these tests.

Latest standalone test results against the verified export: archived/hidden
**357 (110 + 97 + 150)**; Cabin **130 / sum 650 / exact mean 5.0 / stored 5.0**;
A-Frame **0 / no mean / stored 0**; Stone House **0 / no mean / stored 0**;
Lux Cabin **0 / no mean / stored 0**. All 130 Cabin full-document fingerprints
remain identical. Injected partial hide and stats-write interruptions resumed
successfully; rollback resumed after a partial restore and restored the exact
original export state. These are **local isolated database measurements using
the real export**, not staging or post-correction production measurements.
The export's matching reads are explicitly not a snapshot.

## Verified export and production execution gates

The read-only production export was validated and privately transferred to the
operator's local state:

- SHA-256:
  `d40a710744d354da87d05a08d8b8502fadcc9e39a47d401ccde75d89fc6847e7`
- 487 reviews: 357 exact inventory records and 130 Cabin records.
- Five projected property statistics/ownership documents.
- Two full read hashes match and the deployment identity remained stable. This
  is **not** a transactionally consistent or point-in-time snapshot.
- Observed pre-correction production statistics: Cabin 130, sum 650, mean 5.0,
  stored 0/0; A-Frame 110, sum 541, mean 4.9181818, stored type 110/4.9 and
  linked Cabin 0/0; Stone House 97, sum 470, mean 4.8453608, stored 97/4.8;
  Lux Cabin 150, sum 731, mean 4.8733333, stored 150/4.9. These are export
  observations, not post-correction results.
- The export was protected as private files with mode `0600` and a `0700`
  parent. It contains private review records and must not be committed, printed,
  or copied to public CI artifacts.

Before any production write:

1. Obtain explicit final approval for the exact reviewed correction, scope,
   operator, window, retention policy and rollback decision. The read-only export
   approval is not write approval.
2. The authorized operator must use the existing private full-backup mechanism
   `/home/illoc/bin/driftdwells-backup.sh`, which creates a broad MongoDB-and-
   uploads backup. Keep it private and separate from this review-only export.
   Verify the backup job completed, validate its integrity and restore viability
   using the established backup process, and record its private location and
   retention. Stop if those checks fail. Do not copy the backup into the repo or
   staging, and do not run it from this worktree.
3. Reconcile the independently verified full backup with the scoped export and
   exact pinned inventory. Reconfirm target identity, ownership and all
   preconditions; investigate any drift and the separately detected hidden
   Stone House record before expanding the allowlist.
4. The tested `standalone.cjs` commands are loopback-only and **must not** be
   pointed at production or weakened. No production-capable correction command
   is provided or authorized by this preparation. Before approval can be
   executable, a separate production procedure must be reviewed with conditional
   document writes, durable operation journaling, interruption recovery,
   exact backup-bound preconditions, and tested rollback. Do not improvise
   direct database commands.
5. Staging has not been imported or modified. A real staging verification needs
   independently established review-only isolation, no production tunnels or
   writers/jobs/notifications, and separate staging-write approval. Local tests
   do not satisfy that gate.
6. Only after all access, backup, review and approval gates are independently
   met may an authorized operator execute a separately approved change
   procedure. Verify the exact archive and counters, all 130 unchanged Cabin
   documents, and unrelated-system scope; retain the backup, archive and journal.
   No merge, deployment, production write, or release is authorized here.

Website design and frontend files are untouched. No booking/payment systems were
changed. **Ready for final approval means local engineering and verification are
complete; it does not mean staging or production correction has occurred.**
