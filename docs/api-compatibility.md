# Gmail API compatibility

Last audited: 2026-07-22  
Gmail API version: v1  
Discovery revision: `20260713`  
Result: no known contract mismatch for the supported high-level commands

This document is the maintainer-facing compatibility baseline for `gml`. It
records exactly which Gmail API methods the CLI calls, how requests and
responses are transformed, which OAuth scopes are accepted locally, which
limits are enforced before a request, and which parts of Gmail API v1 remain
outside the high-level command surface.

It is an audit snapshot, not a promise that future Gmail API revisions will be
compatible without another review.

## Authoritative sources

- [Gmail API v1 Discovery document](https://gmail.googleapis.com/$discovery/rest?version=v1)
- [Gmail API REST reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1)
- [Gmail OAuth scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Gmail API release notes](https://developers.google.com/workspace/gmail/api/release-notes)

The Discovery document is authoritative for machine-readable method paths,
parameters, request schemas, response schemas, accepted scopes, media upload
support, and the revision recorded above. The REST reference and scope pages
provide the human-readable restrictions and security classification used in
this review.

## Audit scope

The audit covers:

- Every command registered in `src/cli/program.ts` that reaches Gmail API v1.
- The resource clients under `src/gmail/` and their request parameters.
- Scope checks performed before an access token is used.
- Successful API responses and CLI-level normalized results.
- Pagination, batch sizing, label-count, query, body, and file-safety guards.
- Transport behavior that can affect compatibility, including token refresh,
  timeouts, proxy use, and error mapping.

The audit does not claim full coverage of every Gmail API v1 endpoint. The
generic `request` command can reach endpoints that have no dedicated high-level
command, so its request schema, response schema, and required scope are
necessarily caller-owned.

## Transport contract

All high-level resource calls share the following transport behavior:

| Property | Implementation |
| --- | --- |
| Base URL | `https://gmail.googleapis.com/gmail/v1` |
| User | High-level commands use the special user ID `me` |
| Authentication | OAuth 2.0 bearer access token |
| Request encoding | JSON for request bodies; repeated query values are emitted as repeated parameters |
| Response encoding | Successful non-empty bodies must be JSON; empty success bodies become `{}` |
| Timeout | 20 seconds per Gmail API request |
| Token refresh | One forced refresh and one retry after the first `401` response |
| Proxy support | Node HTTP requests honor `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` variants |
| General retries | No automatic retry for `429`, `5xx`, timeouts, or network failures |

The host is fixed by the transport. `request` accepts a Gmail API v1 relative
path or a full URL beginning with the same Gmail v1 base URL; it cannot select
an arbitrary external host through the normal URL builder.

HTTP failures are normalized to stable CLI error codes:

| HTTP or transport failure | CLI error code | Marked retryable |
| --- | --- | --- |
| Invalid request, normally `400` | `gmail_invalid_argument` | No |
| Authentication rejected, `401` after refresh | `gmail_unauthorized` | No |
| Permission or scope denied, `403` | `gmail_forbidden` | No |
| Resource missing, `404` | `gmail_not_found` | No |
| Rate limited, `429` | `gmail_rate_limited` | Yes |
| Gmail server error, `5xx` | `gmail_server_error` | Yes |
| Safe read timed out or could not connect | `gmail_request_timeout` or `gmail_network_error` | Yes |
| Write timed out or could not connect | `gmail_request_timeout` or `gmail_network_error` | No |

The retry flag is guidance for the caller. The CLI deliberately avoids
automatic write retries because a request can complete at Gmail before the
client loses the response.

## Account and label methods

The `full` alias (`https://mail.google.com/`) is accepted by all high-level
commands and is omitted from the scope tables. It is broader than needed for
the operations below.

| Command | Method and path | Request | API response | Narrow accepted aliases |
| --- | --- | --- | --- | --- |
| `profile` | `users.getProfile`: `GET /users/me/profile` | No body | `Profile` | `metadata`, `readonly`, `compose`, `modify` |
| `labels`, `labels list` | `users.labels.list`: `GET /users/me/labels` | No body | `ListLabelsResponse` | `metadata`, `readonly`, `labels`, `modify` |
| `label-create` | `users.labels.create`: `POST /users/me/labels` | `Label` containing the name and visible-list defaults | `Label` | `labels`, `modify` |
| `label-rename` | `users.labels.patch`: `PATCH /users/me/labels/{id}` | `{ "name": "..." }` | `Label` | `labels`, `modify` |
| `label-delete` | `users.labels.delete`: `DELETE /users/me/labels/{id}` | No body | Empty body | `labels`, `modify` |

For `label-rename` and `label-delete`, a system label name is used directly. A
non-system label name or ID is first resolved through `users.labels.list`.
Label filters supplied through `--label` use the same lookup; `--label-id`
avoids the lookup only when the value is a recognized system label, because
user labels are still validated against the label list.

The CLI turns the empty label-delete response into an explicit result containing
`deleted: true` and the resolved label ID.

## Message discovery and reading

### Message listing

`list`, `search`, and `messages list` all call:

```text
users.messages.list
GET /users/me/messages
```

Supported query parameters are:

| CLI input | Gmail parameter | Notes |
| --- | --- | --- |
| Positional query or `--q` | `q` | Gmail search syntax; not permitted with metadata-only access |
| `--max-results` | `maxResults` | CLI range 1 through 500 |
| `--page-token` | `pageToken` | Passed through unchanged |
| `--label` or `--label-id` | Repeated `labelIds` | Names are resolved before listing |
| `--include-spam-trash` | `includeSpamTrash` | Explicit boolean |

The API response is `ListMessagesResponse`. Each listed `Message` normally
contains only `id` and `threadId`, plus `nextPageToken` and
`resultSizeEstimate` at the response level.

Without `--summary`, metadata-only authorization is sufficient when `q` is not
present. With a Gmail query, the CLI requires `readonly` or `modify`, matching
the documented restriction that `q` cannot be used with `gmail.metadata`.

`--summary` performs one additional
`users.messages.get(format=metadata)` request for every listed item, requesting
the `From`, `To`, `Date`, and `Subject` headers. At most six summary requests
are in flight. An individual summary failure is retained in that item's
`error` field and does not discard the successful list response or other
summaries.

### Message retrieval

| Command | API calls | API response | CLI behavior | Narrow accepted aliases |
| --- | --- | --- | --- | --- |
| `messages get` | `users.messages.get` | `Message` | Returns the Gmail resource unchanged under `data` | `metadata` for `metadata` or `minimal`; otherwise `readonly`, `modify` |
| `read` | `users.messages.get(format=full)` | `Message` | Normalizes headers, MIME body, snippet, labels, and attachment metadata | `readonly`, `modify` |
| `read --raw` | `users.messages.get(format=raw)` | `Message` with base64url `raw` | Decodes and emits the RFC 2822 message | `readonly`, `modify` |
| `attachments` | `users.messages.get(format=full)` | `Message` | Walks the MIME tree and returns attachment metadata | `readonly`, `modify` |
| `download` | `users.messages.get(format=full)`, then `users.messages.attachments.get` per selected attachment | `Message`, then `MessagePartBody` | Base64url-decodes data and writes local files | `readonly`, `modify` |

`messages get` permits Gmail formats `full`, `minimal`, `raw`, and `metadata`.
`metadataHeaders` are emitted as repeated query parameters. Metadata-only
authorization is rejected locally for `full` and `raw` before Gmail is called.

Normalized `read` output is limited to 12,000 body characters by default.
`--max-body-chars` accepts a positive custom limit, `--full` removes the local
limit, and `--raw` is mutually exclusive with both. This is a CLI context
safeguard rather than a Gmail API limit.

Attachment downloads create the output directory when needed, sanitize each
destination to the attachment basename, and use exclusive file creation.
Existing files produce `file_exists` unless `--force` is explicit.

## Thread methods

| Command | Method and path | Parameters | API response | Narrow accepted aliases |
| --- | --- | --- | --- | --- |
| `threads` | `users.threads.list`: `GET /users/me/threads` | `q`, `maxResults`, `pageToken`, repeated `labelIds`, `includeSpamTrash` | `ListThreadsResponse` | `metadata` without `q`; otherwise `readonly`, `modify` |
| `thread` | `users.threads.get`: `GET /users/me/threads/{id}` | `format`, repeated `metadataHeaders` | `Thread` | `metadata` for `metadata` or `minimal`; otherwise `readonly`, `modify` |

The list-page range is 1 through 500. Query and metadata restrictions match
message listing.

With `threads --summary`, the CLI calls
`users.threads.get(format=metadata)` once per listed thread with concurrency
limited to six. It reports the message count and fields from the latest message
in each thread. Per-thread failures are embedded in the corresponding summary.

## Sending and draft methods

Outgoing messages are assembled locally as RFC 2822 MIME, encoded with
base64url, and sent inside Gmail's JSON `Message.raw` field. The current client
does not use Gmail media-upload or resumable-upload endpoints.

| Command | API calls | Request | API response | Narrow accepted aliases |
| --- | --- | --- | --- | --- |
| `send` | `users.messages.send` | `{ "raw": "..." }`, optionally with `threadId` | `Message` | `send`, `compose`, `modify` |
| `reply` | `users.messages.get(format=metadata)`, `users.getProfile`, `users.messages.send` | Derived recipients and threading headers plus new MIME content | `Message` | `modify`, or `metadata` plus `send` |
| `forward` | `users.messages.get(format=full)`, optional attachment fetches, `users.messages.send` | New MIME content containing the original message | `Message` | `modify`, or `readonly` plus `send` |
| `draft` | `users.drafts.create` | `{ "message": { "raw": "..." } }` | `Draft` | `compose`, `modify` |
| `drafts` | `users.drafts.list` | `maxResults`, `pageToken`, `q`, `includeSpamTrash` | `ListDraftsResponse` | `readonly`, `compose`, `modify` |
| `draft-send` | `users.drafts.send` | `{ "id": "..." }` | `Message` | `compose`, `modify` |
| `draft-delete` | `users.drafts.delete` | No body | Empty body | `compose`, `modify` |

`reply` reads only the original message metadata needed to construct `To`,
optional reply-all `Cc`, `Subject`, `In-Reply-To`, `References`, and `threadId`.
The narrowest combined authorization is therefore `metadata` plus `send`.

`forward` requires the full original message. Original attachments are fetched
and reattached by default; `--no-attachments` suppresses those fetches.
Additional local attachments can still be supplied explicitly.

The CLI validates that recipients, subjects, body sources, and JSON/file input
options are structurally present, but Gmail remains authoritative for account
sending limits, recipient limits, message size, address policy, and spam
enforcement.

The empty draft-delete response becomes an explicit local deletion result with
the draft ID.

## Message organization methods

The organization commands operate on message resources, not thread resources.
They accept explicit message IDs or resolve a Gmail query through paginated
`users.messages.list` calls.

| Commands | Write method | Successful API response | Narrow accepted aliases |
| --- | --- | --- | --- |
| `modify`, `markread`, `markunread`, `star`, `unstar`, `archive`, `unarchive`, `spam`, `unspam` with one ID | `users.messages.modify` | `Message` | `modify` |
| The same commands with multiple IDs | `users.messages.batchModify` | Empty body per batch | `modify` |
| `trash` | `users.messages.trash` once per ID | `Message` per call | `modify` |
| `untrash` | `users.messages.untrash` once per ID | `Message` per call | `modify` |

Preset label transformations are:

| Command | Add labels | Remove labels |
| --- | --- | --- |
| `markread` | None | `UNREAD` |
| `markunread` | `UNREAD` | None |
| `star` | `STARRED` | None |
| `unstar` | None | `STARRED` |
| `archive` | None | `INBOX` |
| `unarchive` | `INBOX` | None |
| `spam` | `SPAM` | `INBOX` |
| `unspam` | `INBOX` | `SPAM` |

`modify` additionally resolves repeated `--add` and `--remove` label names or
IDs. Duplicate resolved IDs are removed.

The CLI enforces the following write safeguards:

- A query-based write requires `--max-results <count>` or explicit `--all`.
- `--max-results` must be positive; `--all` conflicts with it.
- Query resolution pages through `users.messages.list` in pages of at most 500.
- Repeated page tokens are treated as `pagination_loop` instead of looping
  forever.
- `--dry-run` returns resolved IDs and label changes without a write request.
- `users.messages.batchModify` input is split into at most 1000 message IDs per
  request, matching the official limit.
- Added and removed standard label sets are each capped at 100. This matches the
  documented `users.messages.modify` limit and is conservatively applied to
  `batchModify`, whose current reference does not state a separate standard
  label-count limit.
- A failure after one or more batch or per-message operations reports
  `gmail_partial_failure` with completed work and the failed batch or ID.

For successful modification, the CLI adds `updated` and `batches` counts.
Trash and untrash return completed counts and IDs instead of exposing an array
of full `Message` resources.

## Direct request command

`request` is an escape hatch for Gmail API v1 endpoints without a named
command:

```sh
gml request GET /users/me/history --json
gml request POST /users/me/messages/MESSAGE_ID/modify \
  --body '{"addLabelIds":["STARRED"]}' \
  --json
```

It accepts `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. A request body can come
from `--body` or `--body-file`; conflicting body sources are rejected and the
body must be valid JSON. Unlike message composition, the current `request`
command does not read a JSON body from stdin.

No static method-to-scope check is applied because the endpoint is selected at
runtime. The stored token must contain a Gmail scope, and Gmail performs the
authoritative endpoint-specific permission check. The caller owns the request
schema, response interpretation, idempotency decision, and safety review.

## Scope model

`gml auth login` accepts only the scope aliases declared by the CLI. Arbitrary
scope URLs are rejected.

| Alias | Google OAuth scope | High-level use |
| --- | --- | --- |
| `full` | `https://mail.google.com/` | All Gmail operations, including immediate permanent deletion through `request` |
| `readonly` | `https://www.googleapis.com/auth/gmail.readonly` | Read full messages, attachments, threads, drafts, labels, and profile |
| `metadata` | `https://www.googleapis.com/auth/gmail.metadata` | IDs, labels, headers, and profile without bodies or Gmail queries |
| `modify` | `https://www.googleapis.com/auth/gmail.modify` | Current named read, organize, compose, draft, and send commands |
| `send` | `https://www.googleapis.com/auth/gmail.send` | Send only |
| `compose` | `https://www.googleapis.com/auth/gmail.compose` | Manage drafts and send |
| `insert` | `https://www.googleapis.com/auth/gmail.insert` | Direct `request` calls to insertion/import-related endpoints |
| `labels` | `https://www.googleapis.com/auth/gmail.labels` | List, create, rename, and delete labels |
| `settings.basic` | `https://www.googleapis.com/auth/gmail.settings.basic` | Direct `request` calls to basic Gmail settings endpoints |
| `settings.sharing` | `https://www.googleapis.com/auth/gmail.settings.sharing` | Eligible administrative settings requests |

The local scope implication rules mirror the relevant accepted-method scopes:

- `full` satisfies every high-level requirement.
- `modify` satisfies `readonly`, `metadata`, `send`, `compose`, and `insert`
  requirements where those methods officially accept `gmail.modify`.
- `compose` satisfies a `send` requirement.
- `labels` and settings scopes do not imply general message access.
- Multiple aliases can be requested together for narrow composite workflows,
  such as `metadata,send` for replies.

When `metadata` is requested together with `readonly`, `modify`, or `full`, it
is removed as redundant. This also prevents metadata scope restrictions from
interfering with Gmail query parameters.

The default is `readonly`. `modify` is the practical single scope for every
current named command without granting immediate permanent message deletion.

## Output compatibility

Default text is a presentation layer intended for agent inspection. It is
command-specific and may omit API fields. Stable programmatic consumers should
use `--json` on Gmail API commands.

JSON success output always contains `"ok": true`, but the rest of the shape is
purpose-specific:

| Command class | JSON result |
| --- | --- |
| Direct resource reads and writes | Gmail response under `data` |
| `read` | Normalized message under `data`, or decoded RFC 2822 text under `raw` |
| Lists with `--summary` | Original list fields plus `summaries` under `data` |
| `attachments` | Normalized attachment metadata under `data` |
| `download` | `downloaded` array containing file, byte count, and attachment ID |
| Label or draft deletion | Explicit `deleted` status and resolved resource ID |
| Dry-run organization | `dryRun`, `matched`, target `ids`, and resolved label changes |
| Completed organization | Updated/trashed counts, batch count when relevant, and completed IDs or API data |

Empty successful API responses become `{}` at the transport boundary so callers
never receive `undefined`. Unknown additive Gmail response fields are preserved
for direct resource and `request` JSON output; normalized convenience commands
only expose the fields they intentionally model.

## Quota model

Gmail assigns quota units per API request, not per CLI invocation. Composite
commands can therefore be much more expensive than they appear. Values below
are from the official usage-limits page at the audit date and must be refreshed
when that page changes.

| CLI operation | Approximate Gmail quota units |
| --- | --- |
| `profile` | 1 |
| `labels list` | 1 |
| `label-create` or `label-delete` | 5, plus 1 when label resolution lists labels |
| `messages list` | 5 per page, plus 1 if label-name resolution is needed |
| `messages list --summary` with N results | 5 per list page plus 20 x N |
| `messages get`, `read`, or `attachments` | 20 |
| `download` with A external attachments | 20 plus 20 x A |
| `threads` | 10 per page |
| `threads --summary` with N results | 10 per list page plus 40 x N |
| `thread` | 40 |
| `send` | 100 |
| `reply` | 20 for metadata + 1 for profile + 100 for send |
| `forward` with A included external attachments | 20 + 20 x A + 100 |
| `draft` | 10 |
| `drafts` | 5 per page |
| `draft-send` | 100 |
| `draft-delete` | 10 |
| Single-message label modification | 5 |
| Each `batchModify` batch | 50 |
| Each `trash` call | 20 |
| Each `untrash` call | 5 |

Inline MIME parts do not require `messages.attachments.get`; the attachment
multiplier applies only to parts with an external `attachmentId` fetched by the
CLI.

The CLI limits summary fan-out concurrency to six but does not implement quota
retries. Agents should bound result counts, avoid repeating summaries over the
same page, respect `Retry-After`, and use truncated exponential backoff only for
safe or otherwise idempotent operations.

Google's project, per-user, daily, billing, recipient, and sending limits can
change independently of this repository. The official usage-limits page remains
authoritative.

## Supported and unsupported API surface

High-level commands intentionally cover common agent workflows:

- Profile and label discovery.
- Message and thread listing, search, summaries, and reading.
- Attachment inspection and download.
- Sending, replying, forwarding, drafts, and draft sending/deletion.
- Reversible message organization and trash/untrash.

The following Gmail API features do not have high-level commands:

- Immediate permanent message or thread deletion and `batchDelete`.
- Message import/insert and draft get/update.
- History synchronization, watch, and stop.
- Thread-level modification, trash, untrash, or deletion.
- Gmail settings, filters, forwarding addresses, send-as identities, delegates,
  S/MIME, and client-side encryption resources.
- Workspace Classification Labels.
- Service accounts and domain-wide delegation.

Some of these methods are reachable through `request` when a supported stored
scope is sufficient. They remain outside the typed command, local scope, output,
and safety guarantees documented for high-level commands.

The administrator-only `gmail.modify.restricted` scope used by newer Workspace
classification workflows is not offered by the desktop OAuth alias set. That
scope is tied to service-account domain-wide delegation and is outside the
authentication model of this CLI.

## Known compatibility risks

- The CLI does not load the Discovery document at runtime; API changes require a
  source and documentation update.
- `request` cannot provide compile-time request, response, or scope validation.
- No automatic `429` or `5xx` retry is implemented.
- No media-upload or resumable-upload path is implemented for large messages.
- Recipient, account sending, and final message-size limits are left to Gmail.
- A multi-request command can partially complete. The error reports completed
  work, but rollback is not automatic.
- Summary output intentionally tolerates per-item fetch failures, so callers
  must inspect summary-level `error` fields.
- Testing-mode Google OAuth grants involving Gmail scopes can expire according
  to Google Auth Platform policy even when the Gmail API contract is unchanged.

## Verification evidence

This audit combines three levels of evidence:

1. Static comparison of each resource client with Discovery revision
   `20260713` and the current REST reference.
2. Repository tests covering command routing, scope implication, request
   construction, MIME handling, output normalization, errors, and architecture.
3. Authenticated smoke tests of the named read paths and controlled reversible
   write paths against Gmail API v1.

The smoke tests validate integration behavior but are not continuous conformance
tests. They do not prove compatibility with every account type, Google
Workspace policy, mailbox state, attachment shape, or future API revision.

## Audit procedure

Run this procedure whenever a Gmail resource client, OAuth rule, high-level
command, output contract, or relevant Google API revision changes:

1. Fetch the current Discovery document and record its `revision`.
2. Compare each affected HTTP method, path, parameter, request schema, response
   schema, and accepted scope.
3. Review the REST reference for restrictions that are not fully represented in
   Discovery descriptions.
4. Review the scope page for classification, verification, and administrative
   constraints.
5. Review the usage-limits page for quota, recipient, billing, and sending
   changes.
6. Update resource types, local validation, tests, and this document together.
7. Run `npm run check` and `npm pack --dry-run`.
8. Run only the authenticated smoke tests appropriate to the changed methods.
   Never use an unprepared mailbox for destructive tests.
9. Refresh the audit date, Discovery revision, result, and verification evidence
   only after the review is complete.
