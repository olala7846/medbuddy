import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  MemoryAcceptanceEvaluationScenarioSchema,
  parseMemoryAcceptanceEvaluationScenarios,
} from "./support/memory-acceptance-evaluation.js";

describe("Traditional Chinese memory acceptance evaluation fixture", () => {
  it("parses one exact, strictly governed row for every record type", async () => {
    const raw = await readFile(new URL("./fixtures/memory-acceptance-zh-TW.jsonl", import.meta.url), "utf8");

    const parsed = parseMemoryAcceptanceEvaluationScenarios(raw);

    expect(parsed.map((scenario) => scenario.memoryType)).toEqual(["SEMANTIC", "EPISODIC", "PROCEDURAL"]);
  });

  it.each([
    ["missing required field", { memoryType: "SEMANTIC", body: "虛構內容。",
      expected: { memoryType: "SEMANTIC" } }],
    ["misspelled field", { memoryType: "EPISODIC", body: "虛構內容。",
      expected: { memoryType: "EPISODIC", evnt: "虛構內容。" } }],
    ["unknown field", { memoryType: "PROCEDURAL", body: "請用繁體中文回覆。",
      expected: { memoryType: "PROCEDURAL", preference: "請用繁體中文回覆。",
        preferenceKind: "LANGUAGE", appliesTo: "ALL_RESPONSES", rationale: "not allowed" } }],
    ["mismatched discriminator", { memoryType: "SEMANTIC", body: "虛構內容。",
      expected: { memoryType: "EPISODIC", event: "虛構內容。" } }],
  ])("rejects a malformed row with a %s", (_name, row) => {
    expect(MemoryAcceptanceEvaluationScenarioSchema.safeParse(row).success).toBe(false);
  });
});
