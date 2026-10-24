# Review correction: Phase 1 preparation

**Approval boundary:** the scoped production export, private full backup, restore
verification, and a fresh two-pass production read-only preflight are complete.
No production review/property records were changed, no staging database was
imported or modified, and no deployment or merge was performed. The production
correction command is prepared and guarded but has **not** been run. A separate,
explicit final production-write approval is still required.

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
- The existing `/home/illoc/bin/driftdwells-backup.sh` was run as `illoc`; its
  MongoDB archive and uploads tar were protected and checksummed. The existing
  `driftdwells-restore-verify.sh` verified those checksums and restored the
  archive into its separate `driftdwells_restore_test` database, matched
  collection counts, and removed that test database. It did not restore over
  production collections. The transaction-based `run.cjs backup` is not used
  for this standalone production.
- `standalone.cjs` is a local-only correction/rollback harness. It refuses
  non-loopback database URIs. The fixture is seeded from the verified export,
  archives exact full documents for the 357 allowlisted reviews, conditionally
  changes their status to `hidden`, and updates only the resolved property
  counters. It retains records in the collection, so the operation can be
  reversed. Per-document conditional updates and a durable, checksummed private
  journal support recovery after partial failures; no multi-document
  transaction or atomic snapshot is claimed.
- `production.cjs` is the separate operator workflow. It reads the URI from
  the existing owner-controlled server config, binds execution to the exact
  deployment fingerprint in the verified export, validates the private
  full-backup checksums and restore-verification attestation, and checks all
  allowlisted records plus every currently published rating-1-or-higher review
  in affected owner pools. Preflight performs two complete, independently
  hashed non-transactional reads. Apply and rollback require distinct exact
  confirmation phrases, make per-document conditional updates only, and use
  the same private archive and durable journal tested locally. The tool never
  performs a multi-document transaction.
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
The export's matching reads are explicitly not a snapshot. Latest complete run:
**22 tests passed** against the fresh production export.

## Verified export and production execution gates

The latest read-only production export was validated and privately transferred
to the operator's local state:

- SHA-256:
  `5f56ed30f4698481db02de8f15c0438878a0ec08490a01520ea4e5b46a956b67`
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
- The original and fresh exports contain the same 130 full Cabin documents:
  SHA-256 of the ordered canonical-EJSON records is
  `7119fa82292910f9760d6f09b0f40acf331df7429035a72c2c8716bee97aa6e2`.

The existing full production backup completed at
`/home/illoc/backups/driftdwells/daily/20261024-061021`. The protected MongoDB
archive was 13 MB and the uploads tar was 306 MB. Both SHA-256 entries verified;
the restore verifier matched counts for its 10 checked collections and removed
the isolated restore-test database afterward. The backup remains private on the
production host. Its checksum-set digest recorded by preflight is
`7eba3f06b29e562c2e9dee191405023b32df767687d03596f8906727165e8540`.

Fresh production preflight completed on 24 October 2026 at 06:18:07Z. It read
the same 487 records and five projected property documents twice, with matching
hashes and unchanged deployment identity; `pointInTimeSnapshot` is false. It
also confirmed all public eligible records in the four affected pools are from
the explicit 487-record inventory; an unlisted published lower-rating record
would stop the command. No review/property write was issued.

**Observed current production stats** (not post-correction): Cabin 130, sum 650,
exact mean 5.0, stored 0/0; A-Frame 110, sum 541, mean 4.9181818, type 110/4.9
and linked Cabin 0/0; Stone House 97, sum 470, mean 4.8453608, stored 97/4.8;
Lux Cabin 150, sum 731, mean 4.8733333, stored 150/4.9.

**Expected after an approved correction:** archive and hide A-Frame 110, Stone
House 97, Lux Cabin 150 (357 total); keep The Cabin's 130 reviews byte-for-byte
unchanged. The Cabin would calculate to 130 / sum 650 / exact mean 5.0 and store
130 / 5.0. A-Frame, Stone House and Lux Cabin would each have 0 / no mean / stored
0; both A-Frame owner documents would be set to 0 / 0. No genuine replacements
were provided. These are expectations based on preflight, not measured
production-after results.

Before any production write:

1. Obtain separate final approval for this exact production correction, operator,
   change window and rollback decision. The approved export, backup, restore test
   and read-only preflight are not production-write authorization.
2. Confirm the export has not aged out of the approved change window. If source
   data or MongoDB deployment identity changed, rerun backup/export/preflight
   and restore verification as required; do not bypass fail-closed checks.
3. On the production host as `illoc`, from `/home/illoc`, the read-only command
   already executed was:
   ```sh
   NODE_PATH=/home/illoc/apps/driftdwells-booking-portal/server/node_modules \
   DRIFT_REVIEW_REPO_ROOT=/home/illoc/apps/driftdwells-booking-portal \
     node /home/illoc/.local/state/drift-review-correction/operator/production.cjs \
       preflight --config /home/illoc/.local/state/drift-review-correction/production-phase1/config.json
   ```
4. **Do not run the following until final write approval is explicit.** Apply
   command, with the exact confirmation phrase required by the tool:
   ```sh
   NODE_PATH=/home/illoc/apps/driftdwells-booking-portal/server/node_modules \
   DRIFT_REVIEW_REPO_ROOT=/home/illoc/apps/driftdwells-booking-portal \
     node /home/illoc/.local/state/drift-review-correction/operator/production.cjs \
       apply --config /home/illoc/.local/state/drift-review-correction/production-phase1/config.json \
       --confirm 'APPLY PRODUCTION REVIEW CORRECTION 5f56ed30f4698481db02de8f15c0438878a0ec08490a01520ea4e5b46a956b67 20261024-061021'
   ```
5. If a rollback is separately decided/approved, use the same exact export and
   backup and the opposite confirmation:
   ```sh
   NODE_PATH=/home/illoc/apps/driftdwells-booking-portal/server/node_modules \
   DRIFT_REVIEW_REPO_ROOT=/home/illoc/apps/driftdwells-booking-portal \
     node /home/illoc/.local/state/drift-review-correction/operator/production.cjs \
       rollback --config /home/illoc/.local/state/drift-review-correction/production-phase1/config.json \
       --confirm 'ROLL BACK PRODUCTION REVIEW CORRECTION 5f56ed30f4698481db02de8f15c0438878a0ec08490a01520ea4e5b46a956b67 20261024-061021'
   ```
   The tool will reject a changed deployment, backup, export, inventory, field
   fingerprint, missing record, or property drift. It never deletes review
   documents; archive originals remain private and the journal permits safe
   resume/rollback. Retain the full backup, export, archive and journal.
6. Per the user's approved approach, staging infrastructure is not required for
   this final preparation: the correction was tested in isolated local standalone
   MongoDB against the fresh real production export with interruption and
   rollback scenarios. No staging data or database was created or modified.
7. After any separately approved write, independently verify exact archived
   counts, persisted counters, all 130 unchanged Cabin documents and public
   review visibility. Stop; no merge, deployment or release is authorized.

Website design and frontend files are untouched. No booking/payment systems were
changed. **Ready for final approval means production backup, restore
verification, read-only preflight and local correction testing are complete. It
does not mean production correction has occurred.**
