import { describe, expect, test } from "bun:test";
import { buildProgram } from "@/cli";
import type { CommandInvocation } from "@/commands";

describe("CLI arguments", () => {
  test("Commander produces typed repeated options and positionals", async () => {
    let invocation: CommandInvocation | undefined;
    const program = buildProgram(async (current) => {
      invocation = current;
    });
    await program.parseAsync(["messages", "list", "--label-id", "INBOX", "--label-id=SENT", "--summary"], {
      from: "user",
    });
    expect(invocation).toMatchObject({
      id: "messages.list",
      args: [],
      options: { labelId: ["INBOX", "SENT"], summary: true },
    });
  });

  test("keeps positional arguments after boolean options", async () => {
    const invocations: CommandInvocation[] = [];
    for (const argv of [
      ["read", "--raw", "message-1"],
      ["reply", "--all", "message-1", "--body", "ok"],
      ["forward", "--no-attachments", "message-1", "--to", "a@example.com"],
    ]) {
      const program = buildProgram(async (current) => {
        invocations.push(current);
      });
      await program.parseAsync(argv, { from: "user" });
    }
    expect(invocations.map((invocation) => invocation.args[0])).toEqual(["message-1", "message-1", "message-1"]);
    expect(invocations[0]?.options.raw).toBe(true);
    expect(invocations[1]?.options.all).toBe(true);
    expect(invocations[2]?.options.attachments).toBe(false);
  });

  test("rejects unknown options", async () => {
    const program = quietProgram();
    await expect(program.parseAsync(["list", "--max-result", "10"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
  });

  test("accepts global OAuth options after nested commands", async () => {
    let invocation: CommandInvocation | undefined;
    const program = buildProgram(async (current) => {
      invocation = current;
    });
    await program.parseAsync(["auth", "login", "--no-open", "--client-id", "test", "--scope", "readonly"], {
      from: "user",
    });
    expect(invocation).toMatchObject({
      id: "auth.login",
      options: { clientId: "test", open: false, scope: ["readonly"] },
    });
  });

  test("offers JSON output for Gmail commands only", async () => {
    let invocation: CommandInvocation | undefined;
    const gmailProgram = buildProgram(async (current) => {
      invocation = current;
    });
    await gmailProgram.parseAsync(["profile", "--json"], { from: "user" });
    expect(invocation).toMatchObject({ id: "profile", options: { json: true } });

    await expect(quietProgram().parseAsync(["auth", "status", "--json"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
  });

  test("validates Gmail list page sizes", async () => {
    await expect(
      quietProgram().parseAsync(["messages", "list", "--max-results", "501"], { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.invalidArgument" });
  });

  test("parses read body limits and rejects conflicting modes", async () => {
    let invocation: CommandInvocation | undefined;
    const program = buildProgram(async (current) => {
      invocation = current;
    });
    await program.parseAsync(["read", "message-1", "--max-body-chars", "5000"], { from: "user" });
    expect(invocation).toMatchObject({
      id: "messages.read",
      options: { maxBodyChars: 5000 },
    });

    await expect(
      quietProgram().parseAsync(["read", "message-1", "--full", "--max-body-chars", "5000"], { from: "user" }),
    ).rejects.toMatchObject({ code: "commander.conflictingOption" });
  });
});

function quietProgram() {
  return buildProgram(async () => undefined).configureOutput({
    writeErr: () => undefined,
    outputError: () => undefined,
  });
}
