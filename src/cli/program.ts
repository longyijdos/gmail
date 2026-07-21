import { Command, CommanderError, Option } from "commander";
import { runCommand } from "../commands";
import { CliError } from "./json";

export async function executeCommand(argv: string[]): Promise<unknown | undefined> {
  let result: unknown | undefined;
  const run = async () => {
    result = await runCommand(argv);
  };
  const program = buildProgram(run);

  try {
    await program.parseAsync(argv, { from: "user" });
    return result;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.help" ||
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      ) {
        return undefined;
      }
      throw new CliError(error.message, "args_invalid", undefined, error.exitCode);
    }
    throw error;
  }
}

export function buildProgram(run: () => Promise<void>): Command {
  const program = new Command()
    .name("gml")
    .description("A Gmail CLI for agents and scripts")
    .version("0.1.0")
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
  runnable(auth.command("login").description("Authorize access to Gmail"), run)
    .option("--no-open", "print the authorization URL without opening a browser")
    .option("--scope <scope>", "Gmail scope alias; repeat or comma-separate for multiple scopes", collect);
  runnable(auth.command("status").description("Show authorization status"), run);
  runnable(auth.command("logout").description("Delete stored credentials"), run);

  apiRunnable(program.command("profile").description("Show the Gmail profile"), run);

  const labels = program.command("labels").description("List Gmail labels");
  apiRunnable(labels, run);
  apiRunnable(labels.command("list").description("List Gmail labels"), run);
  apiRunnable(program.command("label-create [name]").description("Create a label"), run)
    .option("--name <name>", "label name");
  apiRunnable(program.command("label-delete <label>").description("Delete a label by name or id"), run);
  apiRunnable(program.command("label-rename <label>").description("Rename a label"), run)
    .requiredOption("--to <name>", "new label name");

  addListOptions(
    apiRunnable(program.command("list [query...]").description("List messages, optionally using a Gmail query"), run),
  ).option("--q <query>", "Gmail search query");
  addListOptions(
    apiRunnable(program.command("search [query...]").description("Search messages using Gmail query syntax"), run),
  ).option("--q <query>", "Gmail search query");

  const messages = program.command("messages").description("Access Gmail messages");
  messages.action(() => messages.help());
  addListOptions(apiRunnable(messages.command("list").description("List messages"), run))
    .option("--q <query>", "Gmail search query");
  apiRunnable(messages.command("get [id]").description("Get a Gmail API message resource"), run)
    .option("--id <id>", "message id")
    .addOption(new Option("--format <format>", "response format").choices(["full", "minimal", "raw", "metadata"]))
    .option("--metadata-header <name>", "metadata header to include; repeat for multiple headers", collect);

  apiRunnable(program.command("read [id]").description("Read a normalized message"), run)
    .option("--id <id>", "message id")
    .option("--raw", "return the raw RFC 2822 message");

  addThreadListOptions(
    apiRunnable(program.command("threads [query...]").description("List threads"), run),
  ).option("--q <query>", "Gmail search query");
  apiRunnable(program.command("thread [id]").description("Get a thread"), run)
    .option("--id <id>", "thread id")
    .addOption(new Option("--format <format>", "response format").choices(["full", "minimal", "metadata"]));

  apiRunnable(program.command("attachments [message-id]").description("List message attachments"), run)
    .option("--id <id>", "message id");
  apiRunnable(program.command("download [message-id]").description("Download message attachments"), run)
    .option("--id <id>", "message id")
    .option("--attachment <id>", "download only one attachment")
    .option("--out <directory>", "output directory", ".");

  addComposeOptions(
    apiRunnable(program.command("send").description("Send a message"), run)
      .requiredOption("--to <address>", "recipient; repeat for multiple recipients", collect)
      .requiredOption("--subject <subject>", "message subject"),
  );

  addBodyOptions(
    apiRunnable(program.command("reply [message-id]").description("Reply to a message"), run)
      .option("--id <id>", "message id")
      .option("--all", "reply to all recipients")
      .option("--attach <path>", "attachment path; repeat for multiple files", collect),
  );

  addOptionalBodyOptions(
    apiRunnable(program.command("forward [message-id]").description("Forward a message"), run)
      .option("--id <id>", "message id")
      .requiredOption("--to <address>", "recipient; repeat for multiple recipients", collect)
      .option("--cc <address>", "CC recipient; repeat for multiple recipients", collect)
      .option("--bcc <address>", "BCC recipient; repeat for multiple recipients", collect)
      .option("--attach <path>", "additional attachment; repeat for multiple files", collect)
      .option("--no-attachments", "do not include attachments from the original message"),
  );

  addComposeOptions(
    apiRunnable(program.command("draft").description("Create a draft"), run)
      .requiredOption("--to <address>", "recipient; repeat for multiple recipients", collect)
      .requiredOption("--subject <subject>", "message subject"),
  );
  apiRunnable(program.command("drafts").description("List drafts"), run)
    .option("--max-results <count>", "maximum number of drafts");
  apiRunnable(program.command("draft-send [draft-id]").description("Send a draft"), run)
    .option("--id <id>", "draft id");
  apiRunnable(program.command("draft-delete [draft-id]").description("Delete a draft"), run)
    .option("--id <id>", "draft id");

  apiRunnable(program.command("modify [ids...]").description("Add or remove labels from messages"), run)
    .option("--query <query>", "select messages using a Gmail query")
    .option("--max-results <count>", "maximum query results", "100")
    .option("--add <label>", "label to add; repeat for multiple labels", collect)
    .option("--remove <label>", "label to remove; repeat for multiple labels", collect);

  for (const [name, description] of [
    ["trash", "Move messages to trash"],
    ["untrash", "Restore messages from trash"],
    ["markread", "Mark messages as read"],
    ["markunread", "Mark messages as unread"],
    ["star", "Star messages"],
    ["unstar", "Remove stars from messages"],
    ["archive", "Archive messages"],
    ["unarchive", "Move messages to the inbox"],
    ["spam", "Mark messages as spam"],
    ["unspam", "Remove messages from spam"],
  ] as const) {
    apiRunnable(program.command(`${name} [ids...]`).description(description), run)
      .option("--query <query>", "select messages using a Gmail query")
      .option("--max-results <count>", "maximum query results", "100");
  }

  apiRunnable(program.command("request [method] [path]").description("Call a Gmail API endpoint directly"), run)
    .addOption(new Option("--method <method>", "HTTP method").choices(["GET", "POST", "PUT", "PATCH", "DELETE"]))
    .option("--path <path>", "Gmail API path")
    .option("--body <json>", "JSON request body")
    .option("--body-file <path>", "read the JSON request body from a file");

  return program;
}

function runnable(command: Command, run: () => Promise<void>): Command {
  return command.allowExcessArguments(false).action(run);
}

function apiRunnable(command: Command, run: () => Promise<void>): Command {
  return runnable(command, run).option("--json", "output JSON");
}

function addListOptions(command: Command): Command {
  return command
    .option("--max-results <count>", "maximum number of messages")
    .option("--page-token <token>", "pagination token")
    .option("--label <label>", "label name or id; repeat for multiple labels", collect)
    .option("--label-id <id>", "label id; repeat for multiple labels", collect)
    .addOption(new Option("--include-spam-trash <boolean>", "include spam and trash").choices(["true", "false", "1", "0"]));
}

function addThreadListOptions(command: Command): Command {
  return command
    .option("--max-results <count>", "maximum number of threads")
    .option("--page-token <token>", "pagination token")
    .option("--label <label>", "label name or id; repeat for multiple labels", collect)
    .option("--label-id <id>", "label id; repeat for multiple labels", collect);
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
