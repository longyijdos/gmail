import { describe, expect, test } from "bun:test";
import { expandScopes, GMAIL_SCOPES, hasAcceptedScope, normalizeScopes } from "@/auth";

describe("Gmail scopes", () => {
  test("expands aliases and deduplicates", () => {
    expect(expandScopes(["readonly,send", "send"])).toEqual([GMAIL_SCOPES.readonly, GMAIL_SCOPES.send]);
  });

  test("rejects arbitrary scope URIs", () => {
    expect(() => expandScopes(["https://www.googleapis.com/auth/drive.readonly"])).toThrow("Unknown Gmail scope alias");
  });

  test("supports the full Gmail scope alias", () => {
    expect(expandScopes(["full"])).toEqual(["https://mail.google.com/"]);
  });

  test("removes metadata when a broader read scope is present", () => {
    expect(normalizeScopes(["metadata,readonly,send"])).toEqual({
      requested: [GMAIL_SCOPES.metadata, GMAIL_SCOPES.readonly, GMAIL_SCOPES.send],
      normalized: [GMAIL_SCOPES.readonly, GMAIL_SCOPES.send],
      removed: [
        {
          scope: GMAIL_SCOPES.metadata,
          reason: "gmail.metadata is redundant with full/readonly/modify and can restrict Gmail query parameters.",
        },
      ],
    });
  });

  test("keeps standalone metadata", () => {
    expect(normalizeScopes(["metadata"])).toEqual({
      requested: [GMAIL_SCOPES.metadata],
      normalized: [GMAIL_SCOPES.metadata],
      removed: [],
    });
  });

  test("accepts any scope supported by an operation", () => {
    expect(hasAcceptedScope([GMAIL_SCOPES.readonly, GMAIL_SCOPES.compose], [GMAIL_SCOPES.compose])).toBe(true);
    expect(hasAcceptedScope([GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata], [GMAIL_SCOPES.metadata])).toBe(true);
    expect(hasAcceptedScope([GMAIL_SCOPES.readonly], [GMAIL_SCOPES.metadata])).toBe(false);
  });
});
