import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { describe, expect, test } from "vitest";
import { configureProxyFromEnvironment } from "@/utils";

describe("proxy environment", () => {
  test("leaves the global dispatcher unchanged without proxy variables", () => {
    const dispatcher = getGlobalDispatcher();

    expect(configureProxyFromEnvironment({})).toBe(false);
    expect(getGlobalDispatcher()).toBe(dispatcher);
  });

  test("installs an environment proxy dispatcher when configured", async () => {
    const original = getGlobalDispatcher();

    try {
      expect(configureProxyFromEnvironment({ HTTPS_PROXY: "http://127.0.0.1:7897" })).toBe(true);
      expect(getGlobalDispatcher()).not.toBe(original);
    } finally {
      const configured = getGlobalDispatcher();
      setGlobalDispatcher(original);
      await configured.close();
    }
  });
});
