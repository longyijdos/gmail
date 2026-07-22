# gml

`gml` is a Gmail CLI for agents and scripts. It prints concise, command-specific
text by default and offers structured JSON for Gmail API commands. It uses
Google's OAuth 2.0 installed-app flow and the Gmail REST API without running a
daemon.

## Install

```sh
bun install -g @longyijdos/gmail
```

During local development:

```sh
bun install
bun run check
bun run build
./dist/gml.js help
```

`bun install` also installs a Husky pre-commit hook that runs `bun run check`.

Code quality commands:

```sh
bun run format        # format files in place
bun run format:check  # verify formatting only
bun run lint          # run the linter
bun run lint:fix      # apply safe lint fixes
bun run check:fix     # format, lint, typecheck, and test
```

## Google setup

Create an OAuth client in Google Cloud Console. Use a Desktop app client when possible. The CLI prints the authorization URL, opens it in a browser, and listens on a local loopback callback URL.

You provide OAuth client credentials during login. After successful login, `gml` persists the parsed client id/secret together with the token so later commands can refresh automatically.

Option 1: use the Google client secret JSON downloaded from GCP:

```sh
gml auth login --client-secret-file /path/to/client_secret_....json
```

Option 2: pass values through flags or environment variables:

```sh
gml auth login --client-id "$GML_CLIENT_ID" --client-secret "$GML_CLIENT_SECRET"
```

To open the printed URL yourself instead of launching a browser:

```sh
gml auth login --no-open --client-secret-file /path/to/client_secret_....json
```

By default, login requests `gmail.readonly`. Request extra scopes explicitly:

```sh
gml auth login \
  --client-secret-file /path/to/client_secret_....json \
  --scope readonly \
  --scope send
```

Scope aliases:

- `full` → `https://mail.google.com/`
- `readonly` → `https://www.googleapis.com/auth/gmail.readonly`
- `metadata` → `https://www.googleapis.com/auth/gmail.metadata`
- `modify` → `https://www.googleapis.com/auth/gmail.modify`
- `send` → `https://www.googleapis.com/auth/gmail.send`
- `compose` → `https://www.googleapis.com/auth/gmail.compose`
- `insert` → `https://www.googleapis.com/auth/gmail.insert`
- `labels` → `https://www.googleapis.com/auth/gmail.labels`
- `settings.basic` → `https://www.googleapis.com/auth/gmail.settings.basic`
- `settings.sharing` → `https://www.googleapis.com/auth/gmail.settings.sharing`

Arbitrary scope strings are intentionally rejected. The CLI supports only these ten Gmail scopes. `full` is the broadest option and includes immediate permanent deletion capability.

## Storage

`gml` stores local state under:

1. `GML_HOME`, if set
2. `$XDG_CONFIG_HOME/gml`, if set
3. `~/.config/gml`

File:

- `credentials.json`: OAuth client id/secret, access token, refresh token, expiry, and granted scopes

The original `client_secret_....json` file path is not persisted. Only the parsed `clientId` and `clientSecret` are stored.

The credentials file is written with private file mode `0600`; the directory is created with `0700`. Credentials are local plaintext secrets, protected by filesystem permissions only.

## Commands

Commands print concise text by default. Commands which call the Gmail API accept
`--json` for structured output. Help, version, and `auth` commands always use text.
Successful output is written to stdout and errors are written to stderr in both
text and JSON modes.

```sh
gml --help
gml help send
gml --version
```

```sh
gml messages list --q 'is:unread' --max-results 10
gml messages list --q 'is:unread' --max-results 10 --summary
gml messages list --q 'is:unread' --max-results 10 --json
```

`--summary` adds sender, date, subject, labels, and snippet while keeping the
list compact. It performs one metadata request per listed message with bounded
concurrency. Use `--json` when the caller needs the complete response envelope.

```sh
gml auth status
gml auth logout
gml profile
gml labels list
gml label-create Work
gml label-rename Work --to Clients
gml messages list --q 'from:alice@example.com newer_than:7d' --max-results 10
gml messages get MESSAGE_ID --format metadata --metadata-header Subject --metadata-header From
gml list 'is:unread newer_than:3d' --max-results 10
gml read MESSAGE_ID
gml read MESSAGE_ID --full
gml threads 'from:alice@example.com' --max-results 10 --summary
gml attachments MESSAGE_ID
gml download MESSAGE_ID --out ./attachments
gml download MESSAGE_ID --out ./attachments --force
gml send --to bob@example.com --subject 'hello' --body 'Body'
gml send --to bob@example.com --subject 'hello' --html --body-file note.html --attach report.pdf
gml reply MESSAGE_ID --body 'Thanks' --all
gml forward MESSAGE_ID --to carol@example.com --body 'FYI'
gml draft --to bob@example.com --subject 'Draft' --body 'Body'
gml draft-send DRAFT_ID
gml modify MESSAGE_ID --add STARRED --remove UNREAD
gml markread --query 'is:unread older_than:30d' --max-results 100 --dry-run
gml markread --query 'is:unread older_than:30d' --max-results 100
gml archive MESSAGE_ID
gml request GET /users/me/messages
gml request POST /users/me/messages/send --body '{"raw":"..."}'
```

Query-based write commands require either `--max-results <count>` or an explicit
`--all`. Use `--dry-run` first to inspect the resolved message IDs. Gmail batch
modifications are automatically split into requests of at most 1000 message
IDs. Downloads refuse to replace existing files unless `--force` is present.

`read` returns at most 12,000 normalized body characters by default and marks
truncated output. Use `--max-body-chars <count>` to choose another limit,
`--full` for the complete normalized body, or `--raw` for the complete RFC 2822
message.

The implemented endpoints and response types are tracked in
[`docs/gmail-api-audit.md`](docs/gmail-api-audit.md).
Agent-oriented workflows and the output contract are documented in
[`docs/agent-usage.md`](docs/agent-usage.md).

## npm release

Releases are published by [GitHub Actions](.github/workflows/publish.yml) through
npm trusted publishing. The tag must match the version in `package.json`.

```sh
npm version patch --no-git-tag-version
bun run check
git add package.json
git commit -m "chore(release): v0.1.1"
git tag -a v0.1.1 -m "v0.1.1"
git push origin main v0.1.1
```

To inspect the package without publishing:

```sh
npm pack --dry-run
```

The package `prepack` hook runs the full checks and rebuilds `dist/gml.js`. The
release workflow uses the `npm` GitHub Environment and does not store an npm
token in repository secrets.
