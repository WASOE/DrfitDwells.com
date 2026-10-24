# Review correction: Phase 1 preparation only

**Approval boundary:** the current task authorizes only a narrowly scoped,
read-only production export using `export.cjs`. Full production backup and real
staging verification are **BLOCKED**. This worktree has no production config, so
no export was performed here. No production writes, staging modifications, merge
or deployment are authorized. The code-review PR does not authorize operational
execution.

## Scope and evidence

The 22 October 2026 private audit contains 487 unique public records: 130 Cabin
imports and 357 generator records (A-Frame 110, Stone House 97, Lux Cabin 150).
The two A-Frame endpoints share one pool, not 220 unique records.

`core.cjs` pins SHA-256 digests of the exact CSV inventory and public snapshot.
It uses all 357 exact IDs, validates complete generator index sequences,
source/owner/external-ID/creation-window provenance, and compares **every**
public snapshot field, including text, rating, identity, dates and the edited
Lux record. A broad `source=manual` predicate is never used.

No genuine replacements or original Airbnb export were supplied. No testimonials
are invented, copied across accommodations, rewritten, or upgraded. Additional
published records, changed fingerprints, changed Cabin inventory, changed
ownership, or post-backup state drift stop the operation for evidence review.
Hidden/pending/deleted and unrelated records are retained. All 130 Cabin review
documents remain untouched, including their private fields.

The current `rating >= 2` public/statistics policy and frontend remain unchanged.
Preflight checks published records at both thresholds 1 and 2 and refuses an
unreviewed difference. Future scope must address this policy separately; do not
silently exclude genuine lower-rated feedback or certify source flags as proof.
The current Cabin 5.0 is a **preserved-import aggregate, not independently verified
Airbnb original scores or proof that the source export is complete**.

## Files and behavior

- `export.cjs` is a separate read-only operator command using `server/.env` and
  the existing `MONGODB_URI` / `MONGO_URI` server settings. It reads only
  `reviews`, `cabins` and `cabintypes`, within a snapshot transaction. The review
  query is constrained to all 357 pinned synthetic IDs plus the 130 records
  owned by The Cabin. It queries all Review documents only for the four
  allowlisted property owner pools (including A-Frame's linked owner) and aborts
  unless that query resolves to exactly 487 unique documents matching every
  public fingerprint; any extra hidden, pending, deleted or public review in
  those pools requires evidence review before retry. It reads only five explicitly
  identified property documents and projects review counters plus the ownership
  fields needed to explain the A-Frame shared pool. No other reviews, properties,
  bookings, guests, payments or customer collections are exported.
- The resulting single canonical-EJSON file is the **review-only staging dataset
  package**: exact full native review documents and five narrowly projected
  statistics/ownership documents, with a SHA-256 manifest and measured per-pool
  statistics. It is written mode `0600` under a new mode `0700` private directory,
  exclusively created, fsynced, and read-back verified. The command only issues
  MongoDB reads; it does not change staging or production. Keep source audit
  files, package, manifest and any transfer restricted; encrypt at rest/in transit
  through the approved operator channel and remove temporary copies per retention
  policy.
- `run.cjs backup` reads native collections without models or application startup:
  **all** Review documents, all statuses, soft-deleted records, `raw`, moderation
  metadata, and complete Cabin/CabinType ownership and statistics documents.
  No booking, payment, notification, job or unrelated collection is exported.
  A snapshot transaction requires a replica set. No indexes or DB writes occur.
- Canonical EJSON preserves native BSON dates, ObjectIds, integer/double/long,
  binary and decimal values without model selection or default-value injection.
  The manifest includes target identity, counts, file SHA-256 and whole-state
  hashes, and is verified by reading the file back.
- `plan` is offline: it validates a full private backup against the pinned audit.
  A public API snapshot alone **cannot** be passed off as a full database backup.
- `apply-staging` writes an immutable private archive of exactly 357 complete
  originals **before** any DB mutation. It then transactionally removes only
  those IDs from the live Review collection and updates only resolved property
  counters. The private file archive has no model, collection, route, static
  directory or public import surface; it cannot be reapproved through moderation.
  Removing from the live collection, rather than merely hiding, also excludes
  these records from admin-derived counts and any other live review consumer.
- Both the canonical A-Frame type and linked Cabin counters are corrected.
  Exact means and stored one-decimal means are reported separately; zero
  reviews means `exactMean: null` and existing database sentinel `averageRating: 0`.
- The complete review/property state is checked inside the transaction before
  and after writes. A repeat apply against the same backup is an exact no-write
  no-op. Anything other than the exact before/after state is rejected.
- `rollback-staging` uses the same verified backup and archive. It restores the
  exact originals and original property documents/counters in a transaction;
  it refuses post-correction drift. Repeat rollback is also a no-write no-op.
  Archive/backup files are retained. This is rollback **preparation**, never
  authorization for production rollback.

Archive, backup, manifest and receipt files are exclusive-create, mode `0600`,
read-back verified and fsynced (including the containing directory). Private run
directories and their dedicated root must be owned by the current user with
mode `0700` under `~/.local/state/drift-review-correction/<run>/`, outside the repo
and all web roots. No review text or private fields are printed in receipts.
Keep these private artifacts out of git, static serving, shared folders and
public CI artifacts; restrict host access and arrange encrypted private retention
according to operational policy before any authorized full export.

The old `generateValleyReviewsImproved.js` entry point now throws immediately,
without loading dependencies or connecting. Its generator, destructive importer
and statistics mutation code have been removed. No repository launcher was found.
Existing Airbnb processing/import scripts are **not safe reconciliation tools**:
they are unchanged, out of this phase, and must not be run to repair Cabin ratings.

## Local verification (not staging)

Restore locked server dependencies if missing. The test requires the private
original audit artifacts; it intentionally fails with guidance if they are absent,
rather than skipping the exact-ID tests or committing guest text to git.

```sh
REVIEW_CORRECTION_AUDIT_DIR=/private/read-only/audit \
  npm run test:review-correction-phase1 --prefix server
```

The suite starts and stops its own loopback MongoDB replica set, not any supplied
database. It loads the public snapshot into an ephemeral **local test fixture**,
adds clearly marked private BSON test metadata and four non-target records, then
exercises full backup, archive, actual public review routes, both A-Frame endpoints,
counters, integrity, offline CLI, drift rejection, idempotence, transaction-failure
atomicity and exact rollback. Command monitoring proves backup and repeat
apply/rollback issue no MongoDB mutation commands. The test's
simulated staging marker is not independent staging certification. It tests no
booking/payment code. It cleans up its own private files and MongoDB process.

Observed local-fixture results: Cabin **130 / exact mean 5.0** (preserved import);
A-Frame **0 / no mean**, Stone House **0 / no mean**, Lux Cabin **0 / no mean**.
Archive **357 = 110 + 97 + 150**. All 130 Cabin native-document fingerprints match
before/after. All four additional records (including lower-rated, hidden, pending,
deleted and unrelated-owner examples) survive unchanged; an unrelated collection
sentinel is untouched. Repeat apply performs no writes; rollback restores the
full native review/property snapshot and rejects drift.

These are **local fixture measurements only**, not staging or production results,
not a full production backup and not a newly verified guest source.

## Future approved operator workflow (do not execute under current approval)

1. Confirm the separate production-export approval, data-retention owner, and
   authorized operator. Use the existing production host/server configuration;
   never copy `.env`, paste its URI, put credentials in arguments, or send them
   through chat. Ensure the reviewed export code and exact pinned evidence are
   verified through the authorized code/artifact channel. This is a temporary
   operator utility run, not a deployment: do not merge/release or add code to
   the live application checkout.
2. On the authorized host, create a private temporary directory under
   `~/.local/state/drift-review-correction/`, mode `0700`; copy only `core.cjs`,
   `run.cjs`, `export.cjs` and the two pinned audit artifacts there through the
   approved restricted channel. Run the script with the existing server's
   installed Node dependencies and configuration-file path (path only, not
   contents):
   ```sh
   NODE_PATH=/home/illoc/apps/driftdwells-booking-portal/server/node_modules \
   DRIFT_REVIEW_ENV_FILE=/home/illoc/apps/driftdwells-booking-portal/server/.env \
     node /home/illoc/.local/state/drift-review-correction/operator/export.cjs \
       --inventory /home/illoc/.local/state/drift-review-correction/audit/generated-review-inventory.csv \
       --snapshot /home/illoc/.local/state/drift-review-correction/audit/production-public-reviews.json
   ```
   The command reads the existing `server/.env` internally, requires it to be
   owner-only/non-symlink, never prints the URI, and creates a private package
   plus SHA-256 manifest. It refuses missing or unsafe config. Do not run the
   broad Mongo+uploads backup for this scoped export. Review its sanitized receipt:
   exactly 487 reviews (357 generator records + 130 Cabin), four Cabin stats
   documents plus one CabinType stats document, fixed evidence hashes, count and
   target fingerprint. Separately verify the manifest against the package with
   these commands, substituting the private path printed in the receipt:
   ```sh
   EXPORT=/private/path/review-only-export-<sha256>.ejson
   MANIFEST="${EXPORT}.manifest.json"
   test "$(sha256sum "$EXPORT" | awk '{print $1}')" = "$(jq -r '.sha256' "$MANIFEST")"
   stat -c '%a %U %n' "$EXPORT" "$MANIFEST" "$(dirname "$EXPORT")"
   ```
   Confirm both files are mode `600`, the directory is mode `700`, and the owner
   is the authorized operator. Export aborts on
   any missing, changed, extra Cabin, or non-allowlisted record. Do not override
   a failed check or edit the pinned evidence.
3. Transfer only the EJSON package and manifest via the approved encrypted
   operator channel to the isolated staging host. Verify its SHA-256 there.
   This package is a data fixture, not an imported or modified staging database.
   Keep backups and package copies private; record retention/deletion.
4. Independently provision and verify a review-only isolated staging replica set
   with no production tunnels, jobs, notifications, booking/payment data or app
   writers. Transfer only authorized review/property data. Establish target
   identity outside this tool, stop all staging writers, and retain evidence of
   isolation. A database name or marker alone is not proof. **Stop before
   importing/modifying staging** unless a distinct approval explicitly authorizes
   staging writes.
5. Staging mutation (only after separate approval) is deliberately restricted to a **loopback, direct-connection**
   replica-set URI with database name `review_correction_staging_<suffix>`.
   Hosted staging is intentionally unsupported by these write commands.
   An authorized operator must separately install the `phase1` record in
   `review_correction_environment`, after independent verification:
   `environment: "staging"`, `isolated: true`, `production: false`, exact
   `database` and `deployment` fingerprint, and
   `approval: "ISOLATED REVIEW-ONLY STAGING; NO PRODUCTION CONNECTION"`.
   The fingerprint is SHA-256 of canonical `{hosts, setName, processId}` from
   MongoDB `hello` (see `targetIdentity`), not a credential. The tool never
   creates this approval marker. A server restart invalidates it and old target
   backups; recapture under renewed identity checks instead of bypassing checks.
6. Create a private mode-0600 JSON config with `privateDirectory`, `uriFile`
   (mode-0600 file holding the explicit URI; no environment URI or dotenv),
   `inventory` and `snapshot` paths, `backup` path when available, and
   `exclusiveReviewOnlyStaging: true` only after stopping other writers.
   Do not put credentials in shell arguments or git.
7. Use `node server/scripts/reviewCorrectionPhase1/run.cjs backup --config
   /private/config.json` on **staging** to capture its own target-bound full backup.
   Production backups cannot be used as staging write authorization.
   Set `backup` in the config, run `plan`, review its exact totals and provenance,
   then use `apply-staging` only with explicit approval. Keep the same backup for
   the no-op repeat check and optional approved `rollback-staging` rehearsal.
8. Re-query staging public routes and all persisted counters, confirm the archive
   and Cabin proof, report exact observed results and approval gates, then STOP.
   No deployment, production writes or follow-on phase is authorized.

**Ready-for-approval means implementation/local verification complete, not
production backup complete or real staging passed.**
