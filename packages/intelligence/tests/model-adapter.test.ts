import { describe, expect, it } from "vitest";

import { FixedModelAdapter, ModelProviderError } from "../src/index.js";

describe("fixed model adapter", () => {
  it("returns scripted success, empty, and malformed responses without interpreting them", async () => {
    const adapter = new FixedModelAdapter(new Map([
      ["success", { kind: "SUCCESS" }],
      ["empty", { kind: "EMPTY" }],
      ["malformed", { unexpected: "malformed fictional output" }],
    ]));

    await expect(adapter.generate({ requestId: "success" })).resolves.toEqual({ kind: "SUCCESS" });
    await expect(adapter.generate({ requestId: "empty" })).resolves.toEqual({ kind: "EMPTY" });
    await expect(adapter.generate({ requestId: "malformed" })).resolves.toEqual({
      unexpected: "malformed fictional output",
    });
  });

  it.each([
    ["timeout", new ModelProviderError("PROVIDER_TIMEOUT")],
    ["provider failure", new ModelProviderError("PROVIDER_ERROR")],
  ])("throws a scripted %s", async (_label, output) => {
    const adapter = new FixedModelAdapter(new Map([["failure", output]]));

    await expect(adapter.generate({ requestId: "failure" })).rejects.toBe(output);
  });
});
