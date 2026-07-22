# Agent usage

`gml` defaults to compact text designed for inspection and tool context. Gmail
API commands also accept `--json` when a caller needs stable field access or the
complete API payload.

## Recommended flow

Check authorization before doing work:

```sh
gml auth status
```

Find candidate messages with enough context to choose the next action:

```sh
gml messages list \
  --q 'is:unread newer_than:7d' \
  --max-results 20 \
  --summary
```

Read only the selected message:

```sh
gml read MESSAGE_ID
```

Preview query-based writes, then repeat without `--dry-run`:

```sh
gml archive --query 'older_than:30d label:newsletters' --max-results 100 --dry-run
gml archive --query 'older_than:30d label:newsletters' --max-results 100
```

Use `--all` only when affecting every query match is intentional. Direct message
IDs do not require a query limit.

## Output contract

- Successful results go to stdout.
- Errors go to stderr and set a nonzero exit code.
- Help, version, and authorization commands are always text.
- Gmail API commands use command-specific text by default.
- With `--json`, successful Gmail results are JSON on stdout and runtime errors
  are JSON on stderr.
- Argument parsing errors occur before a command invocation is available and are
  reported as text on stderr.

JSON errors use a stable envelope:

```json
{
  "ok": false,
  "error": {
    "code": "gmail_rate_limited",
    "message": "Gmail API request was rate limited.",
    "details": {
      "retryable": true,
      "retryAfter": "5"
    }
  }
}
```

Treat `details.retryable` as retry guidance. Apply bounded backoff rather than
immediately repeating a failed request.

## Input and file safety

Prefer `--body-file` or `--body -` for long content to avoid shell quoting
errors. Downloaded attachments do not overwrite existing files unless `--force`
is passed. Query-based write commands require `--max-results` or `--all`, and
support `--dry-run` for target inspection.
