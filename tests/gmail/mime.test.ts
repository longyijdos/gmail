import { describe, expect, test } from "bun:test";
import { buildRaw, encodeMime, parseAddresses } from "@/gmail";

describe("MIME", () => {
  test("encodes a sendable raw message", () => {
    const raw = encodeMime({ to: ["a@example.com"], subject: "Hi", text: "Body" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: a@example.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain(Buffer.from("Body").toString("base64"));
  });

  test("parses quoted display names containing commas", () => {
    expect(parseAddresses('"Doe, Jane" <jane@example.com>, Bob <bob@example.com>')).toEqual([
      { name: "Doe, Jane", email: "jane@example.com", raw: '"Doe, Jane" <jane@example.com>' },
      { name: "Bob", email: "bob@example.com", raw: '"Bob" <bob@example.com>' },
    ]);
  });

  test("rejects MIME header injection", () => {
    expect(() =>
      buildRaw({
        to: ["a@example.com"],
        subject: "Hello\r\nBcc: attacker@example.com",
        text: "Body",
      }),
    ).toThrow("Subject cannot contain line breaks");
    expect(() =>
      buildRaw({
        to: ["a@example.com\r\nBcc: attacker@example.com"],
        subject: "Hello",
        text: "Body",
      }),
    ).toThrow("address cannot contain line breaks");
  });

  test("rejects line breaks in attachment filenames", () => {
    expect(() =>
      buildRaw({
        to: ["a@example.com"],
        subject: "Attachment",
        text: "Body",
        attachments: [{ filename: "report.pdf\r\nX-Test: yes", content: Buffer.from("test") }],
      }),
    ).toThrow("attachment filename cannot contain line breaks");
  });
});
