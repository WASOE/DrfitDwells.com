# Repository Copilot instructions

## Authorized production host access

- The verified SSH alias is `prod-audit`. A BatchMode probe:
  `ssh -o BatchMode=yes prod-audit 'whoami; hostname'`
  succeeded from the authorized CLI environment. Do not infer that the alias
  works from another host, or print connection configuration.
- For an approved operation, run only authorized commands via
  `sudo -n -u illoc`; do not use or reveal SSH keys, environment contents,
  database URIs, command-line credentials, or credential-bearing logs.
- Production configuration is already available to the authorized remote
  operator. Use its established loader only within the approved narrow command;
  never read it into terminal output, copy its values into chat/arguments, or
  expose it in logs. The established whole-database-and-uploads backup is not a
  review-only export method.
- Do not treat SSH access as authorization for production writes. For review
  work, use only an explicitly approved read-only, allowlisted export. Do not
  merge/deploy code or change production records without separate approval.
- For any snapshot export, if the source does not support snapshot transactions,
  stop. Do not remove transaction guarantees, retry with ordinary reads, or
  claim an export until a transactionally consistent, approved source/backup is
  available.
- Never expose SSH keys, MongoDB URIs, environment-file contents, guest-review
  text, private export files, or other credentials/private records in chat,
  command output, commits, or public CI artifacts.

This repository's instructions contain only the credential-free alias and
authorization pattern; do not add internal hostnames, private paths or secrets.
