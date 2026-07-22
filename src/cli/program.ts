import { Command, InvalidArgumentError, Option } from "commander";
import type { CommandArgument, CommandId, CommandInvocation, CommandOptions } from "@/commands";

type CommandRunner = (invocation: CommandInvocation) => Promise<void>;

export function buildProgram(run: CommandRunner, version = "0.1.0"): Command {
  const program = new Command()
    .name("gml")
    .description("A Gmail CLI for agents and scripts")
    .version(version)
    .helpCommand(true)
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({ outputError: () => undefined })
    .option("--client-secret-file <path>", "Google OAuth client secret JSON")
    .option("--client-id <id>", "Google OAuth client id")
    .option("--client-secret <secret>", "Google OAuth client secret");

  program.action(() => program.help());

  const auth = program.command("auth").description("Manage Gmail authorization");
  auth.action(() => auth.help());
  runnable(auth.command("login").description("Authorize access to Gmail"), "auth.login", run)
    .option("--no-open", "print the authorization URL without opening a browser")
    .option("--scope <scope>", "Gmail scope alias; repeat or comma-separate for multiple scopes", collect);
  runnable(auth.command("status").description("Show authorization status"), "auth.status", run);
  runnable(auth.command("logout").description("Delete stored credentials"), "auth.logout", run);

  apiRunnable(program.command("profile").description("Show the Gmail profile"), "profile", run);

  const labels = program.command("labels").description("List Gmail labels");
  apiRunnable(labels, "labels.list", run);
  apiRunnable(labels.command("list").description("List Gmail labels"), "labels.list", run);
  apiRunnable(program.command("label-create [name]").description("Create a label"), "labels.create", run)
    .option("--name <name>", "label name");
  apiRunnable(program.command("label-delete <label>").description("Delete a label by name or id"), "labels.delete", run);
  apiRunnable(program.command("label-rename <label>").description("Rename a label"), "labels.rename", run)
    .requiredOption("--to <name>", "new label name");

  addListOptions(
    apiRunnable(
      program.command("list [query...]").description("List messages, optionally using a Gmail query"),
      "messages.list",
      run,
    ),
  ).option("--q <query>", "Gmail search query");
  addListOptions(
    apiRunnable(
      program.command("search [query...]").description("Search messages using Gmail query syntax"),
      "messages.list",
      run,
    ),
  ).option("--q <query>", "Gmail search query");

  const messages = program.command("messages").description("Access Gmail messages");
  messages.action(() => messages.help());
  addListOptions(apiRunnable(messages.command("list").description("List messages"), "messages.list", run))
    .option("--q <query>", "Gmail search query");
  apiRunnable(messages.command("get [id]").description("Get a Gmail API message resource"), "messages.get", run)
    .option("--id <id>", "message id")
    .addOption(new Option("--format <format>", "response format").choices(["full", "minimal", "raw", "metadata"]))
    .option("--metadata-header <name>", "metadata header to include; repeat for multiple headers", collect);

  apiRunnable(program.command("read [id]").description("Read a normalized message"), "messages.read", run)
    .option("--id <id>", "message id")
    .option("--raw", "return the raw RFC 2822 message");

  addThreadListOptions(
    apiRunnable(program.command("threads [query...]").description("List threads"), "threads.list", run),
  ).option("--q <query>", "Gmail search query");
  apiRunnable(program.command("thread [id]").description("Get a thread"), "threads.get", run)
    .option("--id <id>", "thread id")
    .addOption(new Option("--format <format>", "response format").choices(["full", "minimal", "metadata"]))
    .option("--metadata-header <name>", "metadata header to include; repeat for multiple headers", collect);

  apiRunnable(
    program.command("attachments [message-id]").description("List message attachments"),
    "messages.attachments",
    run,
  ).option("--id <id>", "message id");
  apiRunnable(
    program.command("download [message-id]").description("Download message attachments"),
    "messages.download",
    run,
  )
    .option("--id <id>", "message id")
    .option("--attachment <id>", "download only one attachment")
    .option("--out <directory>", "output directory", ".")
    .option("--force", "overwrite existing files");

  addComposeOptions(
    apiRunnable(program.command("send").description("Send a message"), "messages.send", run)
      .requiredOption("--to <address>", "recipient; repeat for multiple recipients", collect)
      .requiredOption("--subject <subject>", "message subject"),
  );

  addBodyOptions(
    apiRunnable(program.command("reply [message-id]").description("Reply to a message"), "messages.reply", run)
      .option("--id <id>", "message id")
      .option("--all", "reply to all recipients")
      .option("--attach <path>", "attachment path; repeat for multiple files", collect),
  );

  addOptionalBodyOptions(
    apiRunnable(
      program.command("forward [message-id]").description("Forward a message"),
      "messages.forward",
      run,
    )
      .option("--id <id>", "message id")
      .requiredOption("--to <address>", "recipient; repeat for multiple recipients", collect)
      .option("--cc <address>", "CC recipient; repeat for multiple recipients", collect)
      .option("--bcc <address>", "BCC recipient; repeat for multiple recipients", collect)
      .option("--attach <path>", "additional attachment; repeat for multiple files", collect)
      .option("--no-attachments", "do not include attachments from the original message"),
  );

  addComposeOptions(
    apiRunnable(program.command("draft").description("Create a draft"), "drafts.create", run)
      .requiredOption("--to <address>", "recipient; repeat for multiple recipients", collect)
      .requiredOption("--subject <subject>", "message subject"),
  );
  apiRunnable(program.command("drafts").description("List drafts"), "drafts.list", run)
    .addOption(gmailMaxResultsOption("maximum number of drafts"))
    .option("--page-token <token>", "pagination token")
    .option("--q <query>", "Gmail search query")
    .addOption(includeSpamTrashOption());
  apiRunnable(program.command("draft-send [draft-id]").description("Send a draft"), "drafts.send", run)
    .option("--id <id>", "draft id");
  apiRunnable(program.command("draft-delete [draft-id]").description("Delete a draft"), "drafts.delete", run)
    .option("--id <id>", "draft id");

  addBulkOptions(
    apiRunnable(
      program.command("modify [ids...]").description("Add or remove labels from messages"),
      "messages.modify",
      run,
    )
      .option("--add <label>", "label to add; repeat for multiple labels", collect)
      .option("--remove <label>", "label to remove; repeat for multiple labels", collect),
  );

  for (const [name, id, description] of [
    ["trash", "messages.trash", "Move messages to trash"],
    ["untrash", "messages.untrash", "Restore messages from trash"],
    ["markread", "messages.mark-read", "Mark messages as read"],
    ["markunread", "messages.mark-unread", "Mark messages as unread"],
    ["star", "messages.star", "Star messages"],
    ["unstar", "messages.unstar", "Remove stars from messages"],
    ["archive", "messages.archive", "Archive messages"],
    ["unarchive", "messages.unarchive", "Move messages to the inbox"],
    ["spam", "messages.spam", "Mark messages as spam"],
    ["unspam", "messages.unspam", "Remove messages from spam"],
  ] as const) {
    addBulkOptions(apiRunnable(program.command(`${name} [ids...]`).description(description), id, run));
  }

  apiRunnable(
    program.command("request [method] [path]").description("Call a Gmail API endpoint directly"),
    "request",
    run,
  )
    .addOption(new Option("--method <method>", "HTTP method").choices(["GET", "POST", "PUT", "PATCH", "DELETE"]))
    .option("--path <path>", "Gmail API path")
    .option("--body <json>", "JSON request body")
    .option("--body-file <path>", "read the JSON request body from a file");

  return program;
}

function runnable(command: Command, id: CommandId, run: CommandRunner): Command {
  return command.allowExcessArguments(false).action(async () => {
    await run({
      id,
      args: command.processedArgs as CommandArgument[],
      options: command.optsWithGlobals() as CommandOptions,
    });
  });
}

function apiRunnable(command: Command, id: CommandId, run: CommandRunner): Command {
  return runnable(command, id, run).option("--json", "output JSON");
}

function addListOptions(command: Command): Command {
  return command
    .addOption(gmailMaxResultsOption("maximum number of messages"))
    .option("--page-token <token>", "pagination token")
    .option("--label <label>", "label name or id; repeat for multiple labels", collect)
    .option("--label-id <id>", "label id; repeat for multiple labels", collect)
    .addOption(includeSpamTrashOption());
}

function addThreadListOptions(command: Command): Command {
  return command
    .addOption(gmailMaxResultsOption("maximum number of threads"))
    .option("--page-token <token>", "pagination token")
    .option("--label <label>", "label name or id; repeat for multiple labels", collect)
    .option("--label-id <id>", "label id; repeat for multiple labels", collect)
    .addOption(includeSpamTrashOption());
}

function addBulkOptions(command: Command): Command {
  return command
    .option("--query <query>", "select messages using a Gmail query")
    .addOption(positiveCountOption("stop after this many query matches"))
    .option("--all", "allow the query to affect every matching message")
    .option("--dry-run", "resolve and report targets without changing messages");
}

function gmailMaxResultsOption(description: string): Option {
  return new Option("--max-results <count>", description).argParser((value) => parseCount(value, 500));
}

function positiveCountOption(description: string): Option {
  return new Option("--max-results <count>", description).argParser((value) => parseCount(value));
}

function includeSpamTrashOption(): Option {
  return new Option("--include-spam-trash <boolean>", "include spam and trash").argParser(parseBoolean);
}

function parseCount(value: string, maximum?: number): number {
  const count = Number(value);
  if (!/^\d+$/.test(value) || count < 1 || !Number.isSafeInteger(count)) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  if (maximum !== undefined && count > maximum) {
    throw new InvalidArgumentError(`must not exceed ${maximum}`);
  }
  return count;
}

function parseBoolean(value: string): boolean {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new InvalidArgumentError("must be true, false, 1, or 0");
}

function addComposeOptions(command: Command): Command {
  return addBodyOptions(
    command
      .option("--cc <address>", "CC recipient; repeat for multiple recipients", collect)
      .option("--bcc <address>", "BCC recipient; repeat for multiple recipients", collect)
      .option("--from <address>", "From address")
      .option("--attach <path>", "attachment path; repeat for multiple files", collect),
  );
}

function addBodyOptions(command: Command): Command {
  return command
    .option("--body <body>", "message body, or - to read stdin")
    .option("--text <body>", "plain-text message body, or - to read stdin")
    .option("--body-file <path>", "read the message body from a file")
    .option("--html", "interpret the body as HTML");
}

function addOptionalBodyOptions(command: Command): Command {
  return addBodyOptions(command);
}

function collect(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value];
}
