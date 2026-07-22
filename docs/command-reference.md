# Command reference

Use `gml --help` to list commands and `gml help COMMAND` for the authoritative
option list installed with the current version.

## Output modes

Commands print concise text by default. Commands that call the Gmail API also
accept `--json`. Help, version, and `auth` commands always use text.

- Successful results are written to stdout.
- Errors are written to stderr and set a nonzero exit code.
- JSON success responses use an `{ "ok": true, ... }` envelope.
- JSON runtime errors use an `{ "ok": false, "error": ... }` envelope.

See the [Gmail CLI skill](../SKILL.md) for the complete operating and retry
contract.

## Authentication

```sh
gml auth login --client-secret-file /path/to/client_secret.json
gml auth status
gml auth logout
```

OAuth client values may also be supplied through `--client-id`,
`--client-secret`, `GML_CLIENT_SECRET_FILE`, `GML_CLIENT_ID`, and
`GML_CLIENT_SECRET`.

## Discover and read

```sh
gml profile
gml labels list
gml messages list --q 'is:unread' --max-results 10 --summary
gml messages get MESSAGE_ID --format metadata --metadata-header Subject
gml list 'from:alice@example.com newer_than:7d' --max-results 10
gml search 'has:attachment newer_than:30d' --max-results 10
gml read MESSAGE_ID
gml read MESSAGE_ID --max-body-chars 4000
gml read MESSAGE_ID --full
gml threads 'is:inbox newer_than:7d' --max-results 10 --summary
gml thread THREAD_ID
gml drafts
```

`list` and `search` are convenient aliases for message listing. `--summary`
adds sender, date, subject, labels, and snippet with bounded metadata request
concurrency. `read` returns at most 12,000 normalized body characters by
default and reports truncation; `--raw` returns the complete RFC 2822 message.

## Attachments

```sh
gml attachments MESSAGE_ID
gml download MESSAGE_ID --out ./attachments
gml download MESSAGE_ID --attachment ATTACHMENT_ID --out ./attachments
gml download MESSAGE_ID --out ./attachments --force
```

Downloads do not overwrite existing files unless `--force` is present.

## Compose

```sh
gml send --to bob@example.com --subject 'Hello' --body 'Body'
gml send --to bob@example.com --subject 'Report' --body-file note.txt --attach report.pdf
gml reply MESSAGE_ID --body 'Thanks'
gml reply MESSAGE_ID --body 'Thanks everyone' --all
gml forward MESSAGE_ID --to carol@example.com --body 'FYI'
gml draft --to bob@example.com --subject 'Draft' --body 'Body'
gml draft-send DRAFT_ID
gml draft-delete DRAFT_ID
```

Use `--body -` to read a body from stdin and `--html` to interpret the body as
HTML. Recipient and attachment options may be repeated where supported.

## Labels and organization

```sh
gml label-create Work
gml label-rename Work --to Clients
gml label-delete Clients
gml modify MESSAGE_ID --add STARRED --remove UNREAD
gml markread MESSAGE_ID
gml markunread MESSAGE_ID
gml star MESSAGE_ID
gml unstar MESSAGE_ID
gml archive MESSAGE_ID
gml unarchive MESSAGE_ID
gml spam MESSAGE_ID
gml unspam MESSAGE_ID
gml trash MESSAGE_ID
gml untrash MESSAGE_ID
```

Organization commands accept direct message IDs or a Gmail query. A
query-based write requires `--max-results <count>` or an explicit `--all`.
Always resolve targets with `--dry-run` first:

```sh
gml archive --query 'older_than:30d label:newsletters' --max-results 100 --dry-run
gml archive --query 'older_than:30d label:newsletters' --max-results 100
```

Batch modifications are split into Gmail API requests of at most 1000 message
IDs.

## Direct API requests

`request` is an escape hatch for Gmail API v1 endpoints that do not have a
dedicated command:

```sh
gml request GET /users/me/messages
gml request POST /users/me/messages/MESSAGE_ID/modify \
  --body '{"addLabelIds":["STARRED"]}'
```

The caller is responsible for the endpoint, request body, and scope.

## Scope aliases

Pass `--scope` more than once or use a comma-separated value during login.
Arbitrary scope URLs are rejected.

| Alias | Scope |
| --- | --- |
| `full` | `https://mail.google.com/` |
| `readonly` | `https://www.googleapis.com/auth/gmail.readonly` |
| `metadata` | `https://www.googleapis.com/auth/gmail.metadata` |
| `modify` | `https://www.googleapis.com/auth/gmail.modify` |
| `send` | `https://www.googleapis.com/auth/gmail.send` |
| `compose` | `https://www.googleapis.com/auth/gmail.compose` |
| `insert` | `https://www.googleapis.com/auth/gmail.insert` |
| `labels` | `https://www.googleapis.com/auth/gmail.labels` |
| `settings.basic` | `https://www.googleapis.com/auth/gmail.settings.basic` |
| `settings.sharing` | `https://www.googleapis.com/auth/gmail.settings.sharing` |

`readonly` is the default. `modify` covers the current named read, organize,
compose, and send commands without granting immediate permanent deletion.
`full` is intentionally broad and should rarely be necessary.

## Local storage

State is stored under `GML_HOME`, then `$XDG_CONFIG_HOME/gml`, then
`~/.config/gml`. The `credentials.json` file contains the parsed OAuth client,
access token, refresh token, expiry, and granted scopes. It is local plaintext
protected by private filesystem permissions.
