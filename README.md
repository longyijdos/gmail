# gml

[![npm version](https://img.shields.io/npm/v/@longyijdos/gmail)](https://www.npmjs.com/package/@longyijdos/gmail)
[![CI](https://github.com/longyijdos/gmail/actions/workflows/ci.yml/badge.svg)](https://github.com/longyijdos/gmail/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@longyijdos/gmail)](LICENSE)

**Gmail, shaped for agents.**

`gml` gives coding agents and shell workflows direct access to Gmail without a
daemon, browser automation, or an SDK integration. It returns compact,
command-specific text by default and structured JSON when exact fields matter.

## Why gml

- **Agent-first output.** Stable table headers, bounded message bodies, useful
  summaries, and machine-readable errors.
- **One CLI for the full workflow.** Search, read, download, send, reply,
  forward, draft, label, archive, star, spam, and trash.
- **Safe automation.** Query-based writes require an explicit limit or `--all`
  and support `--dry-run` before anything changes.
- **Local OAuth.** Credentials stay on the machine, refresh automatically, and
  are never sent through an intermediary service.
- **Gmail-native.** Queries use Gmail search syntax, and `request` exposes the
  underlying Gmail API when a dedicated command is not enough.

## Install

`gml` requires [Node.js](https://nodejs.org/) 22.12 or later.

```sh
npm install --global @longyijdos/gmail
gml --version
```

## Start in minutes

Create a Google OAuth **Desktop app** client, download its JSON file, then log
in with read-only access:

```sh
gml auth login \
  --client-secret-file ~/Downloads/client_secret_....json \
  --scope readonly
```

Find the messages that matter and read only the one you select:

```sh
gml messages list \
  --q 'is:unread newer_than:7d' \
  --max-results 20 \
  --summary

gml read MESSAGE_ID
```

Use JSON when another tool needs stable field access:

```sh
gml messages list --q 'from:alerts@example.com' --max-results 10 --json
```

Need to organize or send mail? Reauthorize with `--scope modify`, then preview
query-based changes before applying them:

```sh
gml archive \
  --query 'older_than:30d label:newsletters' \
  --max-results 100 \
  --dry-run
```

## Designed for reliable agents

Successful results go to stdout. Errors go to stderr with a nonzero exit code.
Gmail commands support `--json`; help and authentication stay readable text.
Large message bodies are truncated by default, list enrichment uses bounded
concurrency, and retryable API failures are identified explicitly.

```sh
gml help send
gml auth status
gml profile
gml threads 'is:inbox newer_than:7d' --max-results 10 --summary
gml send --to user@example.com --subject 'Status' --body-file report.txt
```

## Documentation

| Guide | Use it for |
| --- | --- |
| [Agent setup](docs/agent-setup.md) | Installing `gml` and creating Google OAuth client credentials |
| [Agent skill](SKILL.md) | Install, authorize, and operate `gml` safely from an agent |
| [Command reference](docs/command-reference.md) | Commands, scopes, credential storage, and examples |
| [Development](docs/development.md) | Local development, CI, hooks, and releases |
| [Gmail API compatibility](docs/api-compatibility.md) | Maintainer audit of endpoints, scopes, limits, and quotas |

## License

[MIT](LICENSE)
