# Manual-block conversion uniqueness index

The conversion path requires the named partial unique index
`booking_conversion_source_block_unique_v1` on
`provenance.convertedFromAvailabilityBlockId`. Conversion fails closed until
inspection confirms the exact key, uniqueness, and ObjectId-only partial filter.

## Preflight (read-only by default)

From `server/`, run:

```sh
node scripts/manualBlockConversionIndexCutover.cjs
```

Review the duplicate provenance groups and current same-name/same-key index.
The command never drops, replaces, or synchronizes indexes.

## Apply

Only after duplicate groups are absent and any malformed same-name/same-key
index has been reviewed and resolved through the repository's approved database
change process, explicitly request creation:

```sh
node scripts/manualBlockConversionIndexCutover.cjs --apply
```

The command rechecks data, creates only the canonical index when it is missing,
then verifies the exact result. It refuses to change a malformed index and
refuses creation when duplicate provenance is present.

## Calendar workflow notes

Manual-block operator notes are stored separately from the audit reason and
are limited to 500 characters. Location-wide block groups share one note;
editing a group is intentionally unsupported because changing only some of its
member blocks would make the group inconsistent. Remove the group and recreate
it with the corrected purpose/note instead.

## Verify and rollback/escalation

Run the dry-run command again and require `indexStatus: exact`, zero duplicate
groups, and no conversion-index readiness errors in the API. Do not remove this
uniqueness constraint as a rollback. If apply partially succeeds or reports a
malformed index, keep conversion unavailable and escalate to the database
operator; do not drop/replace an index automatically. Application rollback may
restore the previous API release while leaving the additive index in place.
