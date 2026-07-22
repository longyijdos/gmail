---
name: gmail-cli
description: Install, authorize, and operate gml for agent-driven Gmail search, reading, drafting, sending, organization, and attachment workflows. Use when an agent needs Gmail access through the @longyijdos/gmail command-line package.
---

# Gmail CLI

Use `gml` to work with Gmail from an agent or script. Prefer narrow queries,
bounded result sets, explicit message IDs, and the least OAuth authority needed
for the task.

## Required references

- If `gml` is missing, authorization is not configured, or the user needs a
  Google OAuth client, read and follow
  [`docs/agent-setup.md`](docs/agent-setup.md). Do not invent an alternative
  installation or credential flow.
- Before using an unfamiliar command or option, read
  [`docs/command-reference.md`](docs/command-reference.md). Treat `gml --help`
  and `gml help COMMAND` from the installed version as authoritative when they
  differ from documentation.
- For endpoint contracts, scope reasoning, API limits, and quota costs, consult
  [`docs/api-compatibility.md`](docs/api-compatibility.md).

Do not ask the user to paste OAuth client secrets, access tokens, refresh
tokens, or credential files into chat. Work with a local file path as described
in the setup guide.

## Start every workflow

Confirm that the executable and authorization are available:

```sh
gml --version
gml auth status
```

If authorization is missing or the granted scopes do not cover the requested
operation, follow the setup guide. Use `readonly` for reading and `modify` only
when the task requires organizing, drafting, or sending mail. Do not request
`full` unless immediate permanent deletion through a direct API request is an
explicit requirement.

## Choose output deliberately

Use the default text output when inspecting results or passing concise context
to another agent. Add `--json` to a Gmail API command when stable field access,
complete resource data, or programmatic parsing is required.

- Successful output is written to stdout.
- Errors are written to stderr and set a nonzero exit code.
- Help, version, and `auth` commands always use text.
- With `--json`, Gmail API successes contain `"ok": true`; runtime errors
  contain `"ok": false` and an `error` object.
- Never attempt to parse default text as JSON.

## Discover before reading

Start with a narrow Gmail query and a bounded summary page:

```sh
gml messages list \
  --q 'is:unread newer_than:7d' \
  --max-results 20 \
  --summary
```

Use `threads` when the task is about conversations rather than individual
messages:

```sh
gml threads 'is:inbox newer_than:7d' --max-results 20 --summary
```

Do not fetch full message bodies for every search result. Select the relevant
message ID first, then read only that message:

```sh
gml read MESSAGE_ID
```

Normalized reads return at most 12,000 body characters by default and report
when truncation occurred. Prefer `--max-body-chars <count>` when context is
limited. Use `--full` or `--raw` only when the task needs the complete content.

## Control side effects

Treat send, reply, forward, draft-send, trash, spam, label deletion, and message
modification as side effects. The user's request authorizes only the described
action; do not broaden recipients, targets, queries, labels, or attachment
selection.

For a query-based write, always inspect the resolved targets first:

```sh
gml archive \
  --query 'older_than:30d label:newsletters' \
  --max-results 100 \
  --dry-run
```

Run the same command without `--dry-run` only when the preview matches the
requested operation. Query-based writes must have `--max-results <count>` or
explicit `--all`. Use `--all` only when the user clearly intends every match.
Direct message IDs do not require a query limit.

Before sending mail, verify the final recipients, subject, body source, and
attachments. Prefer `--body-file` or `--body -` for long or generated content
to avoid shell quoting errors. Do not silently add recipients or forward
original attachments when the request excludes them.

Downloaded attachments do not overwrite existing files unless `--force` is
passed. Do not use `--force` unless replacement is intended.

## Handle failures

Use the process exit code as the primary success signal. When `--json` is
active, inspect `error.code` and `error.details` from stderr.

- Retry safe reads with bounded backoff only when `details.retryable` is true.
- Respect `details.retryAfter` when present.
- Do not blindly retry send or mutation commands after a timeout or network
  failure; Gmail may have completed the request before the response was lost.
- On `scope_missing`, reauthorize only with the narrow scope required by the
  command reference.
- On authentication or setup failures, return to the setup guide instead of
  improvising with credential contents.

## Finish the task

Report what was read or changed, including relevant message, thread, draft, or
label IDs when useful. Do not expose tokens, credential paths, unnecessary
message content, or unrelated mailbox data in the final response.
