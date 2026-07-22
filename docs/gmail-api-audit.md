# Gmail API compatibility audit

Audit date: 2026-07-21

The implemented commands were checked against the official Gmail API v1
Discovery document, revision `20260713`, and the current REST reference:

- Discovery: <https://gmail.googleapis.com/$discovery/rest?version=v1>
- REST reference: <https://developers.google.com/workspace/gmail/api/reference/rest/v1>

`gml --json` wraps successful API data in the CLI's `{ "ok": true, ... }`
envelope. The `data` field follows the response type listed below unless the
command is a normalized convenience command such as `read`, `attachments`, or
`download`. Message lists requested with `--summary` retain the list response
and add a `summaries` array built from `users.messages.get(format=metadata)`.

| Commands | Gmail API method | Successful API response |
| --- | --- | --- |
| `profile` | `users.getProfile` | `Profile` |
| `labels`, `labels list` | `users.labels.list` | `ListLabelsResponse` |
| `label-create` | `users.labels.create` | `Label` |
| `label-rename` | `users.labels.patch` | `Label` |
| `label-delete` | `users.labels.delete` | Empty body |
| `list`, `search`, `messages list` | `users.messages.list` | `ListMessagesResponse` |
| `messages get`, `read`, `attachments` | `users.messages.get` | `Message` |
| `download` | `users.messages.attachments.get` | `MessagePartBody` per attachment |
| `send`, `reply`, `forward` | `users.messages.send` | `Message` |
| `threads` | `users.threads.list` | `ListThreadsResponse` |
| `thread` | `users.threads.get` | `Thread` |
| `draft` | `users.drafts.create` | `Draft` |
| `drafts` | `users.drafts.list` | `ListDraftsResponse` |
| `draft-send` | `users.drafts.send` | `Message` |
| `draft-delete` | `users.drafts.delete` | Empty body |
| `modify`, `markread`, `markunread`, `star`, `unstar`, `archive`, `unarchive`, `spam`, `unspam` | `users.messages.modify` or `users.messages.batchModify` | `Message` for one ID; empty body per batch |
| `trash`, `untrash` | `users.messages.trash` or `users.messages.untrash` | `Message` per ID |
| `request` | Caller-selected Gmail v1 path | Endpoint-dependent |

## Enforced API limits

- Message, thread, and draft list pages accept `maxResults` from 1 through 500.
- Query-based organize commands require `--max-results` or an explicit `--all`.
  They follow `nextPageToken` until that total limit is reached, or until all
  pages are exhausted for `--all`. `--dry-run` resolves targets without writing.
- `users.messages.batchModify` is split into requests of at most 1000 message
  IDs.
- Modify requests reject more than 100 labels in either the add or remove set.

## Scope handling

Local scope checks use the alternatives published for each method. Notable
cases include `users.getProfile` accepting compose or metadata access,
`users.labels.list` accepting labels or metadata access, and
`users.drafts.list` accepting readonly access. Metadata-only access is rejected
before requests that use Gmail search queries or full/raw message formats,
which the API does not allow with that scope.
