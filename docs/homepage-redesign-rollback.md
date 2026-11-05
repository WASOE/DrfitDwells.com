# Homepage redesign rollback

The homepage that was live on `origin/master` before this redesign is preserved exactly.

- Original commit: `9e24982348fab59baa13bbacc91d449de65b82c0`
- Commit subject: Merge pull request #58 from WASOE/integration/release-arrival-safety
- Permanent branch: `preserve/homepage-pre-redesign-9e24982`
- Feature branch: `feat/homepage-commercial-redesign`

This branch was created from that commit. The previous checkout at `/home/wasoe/drift-dwells-booking-portal` was not modified.

## Restore the previous homepage

If this redesign should not ship, leave `master` on `9e24982348fab59baa13bbacc91d449de65b82c0` and close the pull request without merging.

If it has already been merged and must be reverted:

```bash
git fetch origin
git checkout -b rollback/homepage-redesign origin/master
git revert -m 1 <merge-commit-sha>
git push -u origin HEAD
```

Open a revert pull request. Do not reset `master` and do not force-push.

To inspect the previous homepage without changing the current branch:

```bash
git show preserve/homepage-pre-redesign-9e24982:client/src/pages/Home.jsx
```

Or check out only that file from the preserved commit:

```bash
git checkout 9e24982348fab59baa13bbacc91d449de65b82c0 -- client/src/pages/Home.jsx client/src/i18n/locales/en/home.json client/src/i18n/locales/bg/home.json
```
