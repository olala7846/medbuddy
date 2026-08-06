import { describe, expect, it } from "vitest";

import {
  DynamicMemoryPayloadSchema,
  QueryMemoryInputSchema,
} from "../src/index.js";

describe("dynamic memory contracts", () => {
  it.each([
    {
      memoryType: "SEMANTIC",
      statement: "The fictional household uses a blue appointment folder.",
      subjectLabels: ["Grandparent"],
    },
    {
      memoryType: "EPISODIC",
      event: "The fictional family agreed to bring the folder next Tuesday.",
      subjectLabels: ["Grandparent"],
    },
    {
      memoryType: "PROCEDURAL",
      preference: "Use Traditional Chinese for summaries.",
      preferenceKind: "LANGUAGE",
      appliesTo: "SUMMARIES",
      subjectLabels: [],
    },
  ])("accepts one strict $memoryType payload", (payload) => {
    expect(DynamicMemoryPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("rejects mixed memory payloads", () => {
    expect(DynamicMemoryPayloadSchema.safeParse({
      memoryType: "SEMANTIC",
      statement: "A fictional stable detail.",
      event: "A fictional event.",
      subjectLabels: [],
    }).success).toBe(false);
  });

  it("keeps procedural memory workspace-wide", () => {
    expect(DynamicMemoryPayloadSchema.safeParse({
      memoryType: "PROCEDURAL",
      preference: "Use short replies.",
      preferenceKind: "RESPONSE_LENGTH",
      appliesTo: "ALL_RESPONSES",
      subjectLabels: ["One person"],
    }).success).toBe(false);
  });

  it("accepts but does not interpret a deferred subject-label query", () => {
    expect(QueryMemoryInputSchema.parse({ subjectLabels: ["Grandparent"] })).toEqual({
      subjectLabels: ["Grandparent"],
    });
  });
});
