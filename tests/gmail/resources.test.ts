import { describe, expect, test } from "vitest";
import { GMAIL_SCOPES } from "@/auth";
import { modifyMessages, profile } from "@/gmail";
import { withGmailSandbox } from "../support";

describe("Gmail resources", () => {
  test("splits batchModify requests at 1000 message ids", async () => {
    const batchSizes: number[] = [];
    await withGmailSandbox(
      {
        scopes: [GMAIL_SCOPES.modify],
        fetch(_input, init) {
          const body = JSON.parse(String(init?.body)) as { ids: string[] };
          batchSizes.push(body.ids.length);
          return new Response(null, { status: 204 });
        },
      },
      async () => {
        await modifyMessages({ ids: Array.from({ length: 2001 }, (_, index) => `message-${index}`) });
        expect(batchSizes).toEqual([1000, 1000, 1]);
      },
    );
  });

  test("accepts the compose scope for users.getProfile", async () => {
    await withGmailSandbox(
      {
        scopes: [GMAIL_SCOPES.compose],
        fetch() {
          return Response.json({
            emailAddress: "agent@example.com",
            messagesTotal: 1,
            threadsTotal: 1,
            historyId: "10",
          });
        },
      },
      async () => {
        await expect(profile()).resolves.toMatchObject({ emailAddress: "agent@example.com" });
      },
    );
  });
});
