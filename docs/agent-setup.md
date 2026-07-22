# Agent setup

This guide is written for an agent that needs to install `gml` and help a user
connect it to Gmail. Follow the boundary below:

- The agent may install the package, inspect local paths, and run CLI commands.
- The user must sign in to Google, choose the Google account, approve scopes,
  and handle any security or unverified-app prompts.
- Never ask the user to paste a client secret, access token, refresh token, or
  downloaded credential JSON into chat. Work with a local file path instead.

## 1. Check prerequisites

`gml` requires Node.js 22.12 or later and a Google account with Gmail enabled.

```sh
node --version
npm --version
```

If Node.js is missing or too old, direct the user to the official
[Node.js download page](https://nodejs.org/en/download). Do not execute a
remote installation script without the user's approval.

## 2. Install gml

Install the public package from npm:

```sh
npm install --global @longyijdos/gmail
gml --version
gml --help
```

If the shell cannot find `gml`, add npm's global binary directory to `PATH`,
restart the shell, and retry `gml --version`.

## 3. Create a Google Cloud project

The following browser steps require the user to be signed in to Google:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project or select an existing project dedicated to this CLI.
3. Open the [Gmail API library page](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
4. Confirm the intended project is selected, then enable the Gmail API.

Google's current Gmail quickstart also requires enabling the API, configuring
the OAuth consent screen, and creating a Desktop app client. See the official
[Gmail API quickstart](https://developers.google.com/workspace/gmail/api/quickstart/python)
for the current console flow.

## 4. Configure Google Auth Platform

In the selected project, open **Google Auth Platform**.

### Branding

Open **Branding** and provide the required app information. A simple name such
as `gml local` is sufficient for a private development project. Use an email
address the user controls for support and developer contact fields.

### Audience

Open **Audience** and choose the audience appropriate for the account:

- Choose **Internal** only for a Google Workspace organization whose users are
  managed by that same organization.
- Choose **External** for personal Gmail accounts or accounts outside the
  project's organization.

When an External app is in **Testing**, add every Gmail account that will log
in as a test user. Google currently limits Testing projects to 100 test users,
and grants involving Gmail scopes expire after seven days. This includes the
refresh token, so periodic reauthorization is expected while the app remains in
Testing. Review Google's current
[Audience and publishing status documentation](https://support.google.com/cloud/answer/15549945)
before changing the publishing status.

### Data Access

Open **Data Access**, choose **Add or remove scopes**, and add only the Gmail
scopes the user intends to grant:

| gml mode | Google scope | Capability |
| --- | --- | --- |
| `readonly` | `https://www.googleapis.com/auth/gmail.readonly` | Search and read Gmail data |
| `modify` | `https://www.googleapis.com/auth/gmail.modify` | Read, organize, compose, and send |

Start with `readonly` unless write operations are required. Avoid
`https://mail.google.com/` for normal use because it also permits immediate
permanent deletion. Google classifies Gmail scopes as sensitive or restricted;
public multi-user applications can require OAuth verification. See Google's
[scope management documentation](https://support.google.com/cloud/answer/15549135)
and the [Gmail scope list](https://developers.google.com/workspace/gmail/api/auth/scopes).

## 5. Create the client ID and secret

1. Open **Google Auth Platform > Clients**.
2. Select **Create client**.
3. Choose **Desktop app** as the application type.
4. Give it a recognizable name such as `gml on MacBook`.
5. Create the client and immediately download the JSON file.

Use a Desktop app client. `gml` starts a loopback callback server on
`127.0.0.1` with a temporary port; a Web application client and manually
configured redirect URI are not needed.

Google only displays or downloads newly created OAuth client secrets at
creation time. Keep the downloaded file private. If it is lost, create or
rotate the client secret in Google Auth Platform. See Google's
[OAuth client documentation](https://support.google.com/cloud/answer/15549257).

## 6. Log in

Pass the downloaded file by path. Read-only is the default, but spelling it out
makes the requested authority clear:

```sh
gml auth login \
  --client-secret-file ~/Downloads/client_secret_....json \
  --scope readonly
```

For commands that send or modify mail, request `modify` instead:

```sh
gml auth login \
  --client-secret-file ~/Downloads/client_secret_....json \
  --scope modify
```

The CLI prints the authorization URL and normally opens it in the default
browser. Use `--no-open` when the user wants to open the printed URL manually:

```sh
gml auth login \
  --no-open \
  --client-secret-file ~/Downloads/client_secret_....json \
  --scope readonly
```

The browser must be on the same machine as `gml` unless loopback networking is
forwarded correctly. After consent, Google redirects the browser to the local
callback server and `gml` exchanges the code for tokens. The token exchange
requires network access to `oauth2.googleapis.com`; browser consent alone is
not sufficient when that endpoint is blocked by a firewall or proxy.

## 7. Verify the connection

```sh
gml auth status
gml profile
gml messages list --q 'newer_than:1d' --max-results 5 --summary
```

Do not continue to write operations unless `gml auth status` shows the expected
scope and the user explicitly intends the change.

## Credential handling

`gml` stores parsed OAuth client credentials and tokens under the first
available location:

1. `GML_HOME`
2. `$XDG_CONFIG_HOME/gml`
3. `~/.config/gml`

The credentials file is `credentials.json`. The directory is created with mode
`0700` and the file with mode `0600`. The secrets are plaintext protected by
filesystem permissions, so never commit, upload, print, or include that file in
agent context. The original downloaded JSON path is not retained.

## Common failures

| Symptom | Check |
| --- | --- |
| `access_denied` or the account cannot continue | Confirm the account is listed under Audience test users |
| Authorization works, then expires after seven days | The External app is still in Testing; this is expected for Gmail scopes |
| Browser succeeds but the CLI keeps waiting | Confirm the machine can reach `oauth2.googleapis.com`; expose an HTTP proxy through `HTTP_PROXY`/`HTTPS_PROXY` when required |
| Redirect opens but cannot connect | Run the browser on the same machine as the CLI and allow loopback connections |
| `scope_missing` | Run `gml auth login` again with `--scope readonly` or `--scope modify` as required |
| Client secret file is missing | Download at client creation or rotate/create a client; never reconstruct it from chat history |

Once setup succeeds, continue with the [Gmail CLI skill](../SKILL.md). Consult
the [Command reference](command-reference.md) for the complete command surface.
