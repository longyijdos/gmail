# gml

`gml` is a stateless, JSON-first Gmail CLI for agents and scripts. It uses Google's OAuth 2.0 installed-app flow and the official Gmail REST API. It does not run a daemon.

## Install

```sh
bun install -g @longyijdos/gmail
```

During local development:

```sh
bun install
bun run build
./dist/gml.js help
```

## Google setup

Create an OAuth client in Google Cloud Console. Use a Desktop app client when possible. The CLI opens a browser and listens on a local loopback callback URL.

You provide OAuth client credentials during login. After successful login, `gml` persists the parsed client id/secret together with the token so later commands can refresh automatically.

Option 1: use the Google client secret JSON downloaded from GCP:

```sh
gml auth login --client-secret-file /path/to/client_secret_....json
```

Option 2: pass values through flags or environment variables:

```sh
gml auth login --client-id "$GML_CLIENT_ID" --client-secret "$GML_CLIENT_SECRET"
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

All output is JSON, including errors.

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
gml threads 'from:alice@example.com'
gml attachments MESSAGE_ID
gml download MESSAGE_ID --out ./attachments
gml send --to bob@example.com --subject 'hello' --body 'Body'
gml send --to bob@example.com --subject 'hello' --html --body-file note.html --attach report.pdf
gml reply MESSAGE_ID --body 'Thanks' --all
gml forward MESSAGE_ID --to carol@example.com --body 'FYI'
gml draft --to bob@example.com --subject 'Draft' --body 'Body'
gml draft-send DRAFT_ID
gml modify MESSAGE_ID --add STARRED --remove UNREAD
gml markread --query 'is:unread older_than:30d'
gml archive MESSAGE_ID
gml request GET /users/me/messages
gml request POST /users/me/messages/send --body '{"raw":"..."}'
```

## npm release

```sh
bun run check
bun run build
npm publish --access public
```
