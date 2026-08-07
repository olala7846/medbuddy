import { describe, expect, it } from "vitest";

import {
  DYNAMIC_MEMORY_QUERY_HARD_LIMIT,
  DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16,
  DYNAMIC_MEMORY_QUERY_SCAN_LIMIT,
  DYNAMIC_MEMORY_SOURCE_EXCERPT_MAX_UTF16,
  DynamicMemoryPayloadSchema,
  ModelQueryMemoryInputSchema,
  QueryMemoryResultSchema,
  QueryMemoryInputSchema,
  containsFamilyRelationshipTerm,
} from "../src/index.js";

describe("dynamic memory contracts", () => {
  it.each(["Mei is Kai's mum.", "美玲是家豪的媽媽。"])(
    "classifies shared family-relationship material: %s",
    (value) => expect(containsFamilyRelationshipTerm(value)).toBe(true),
  );
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
    expect(QueryMemoryInputSchema.parse({ subjectLabels: ["Grandparent"] })).toMatchObject({
      subjectLabels: ["Grandparent"],
    });
  });

  it("normalizes the complete deterministic query contract with safe defaults", () => {
    expect(QueryMemoryInputSchema.parse({
      memoryTypes: ["SEMANTIC", "EPISODIC"],
      sourceClasses: ["HUMAN_CONVERSATION"],
      trustClasses: ["UNREVIEWED_DERIVED"],
      memberRefs: ["member:fictional-a"],
      acceptedAt: {
        fromInclusive: "2026-08-01T00:00:00.000Z",
        toExclusive: "2026-09-01T00:00:00.000Z",
      },
      tagsAll: ["  APPOINTMENTS  "],
      textTerms: ["  BLUE\tFOLDER "],
      order: "OLDEST_FIRST",
      limit: 25,
    })).toEqual({
      subjectLabels: [],
      memoryTypes: ["SEMANTIC", "EPISODIC"],
      sourceClasses: ["HUMAN_CONVERSATION"],
      trustClasses: ["UNREVIEWED_DERIVED"],
      memberRefs: ["member:fictional-a"],
      acceptedAt: {
        fromInclusive: "2026-08-01T00:00:00.000Z",
        toExclusive: "2026-09-01T00:00:00.000Z",
      },
      tagsAll: ["APPOINTMENTS"],
      textTerms: ["BLUE FOLDER"],
      order: "OLDEST_FIRST",
      limit: 25,
    });
    expect(QueryMemoryInputSchema.parse({})).toEqual({
      subjectLabels: [],
      memoryTypes: [],
      sourceClasses: [],
      trustClasses: [],
      memberRefs: [],
      tagsAll: [],
      textTerms: [],
      acceptedAt: {},
      order: "NEWEST_FIRST",
      limit: 10,
    });
  });

  it("canonicalizes accepted-time offsets before deterministic comparison", () => {
    expect(QueryMemoryInputSchema.parse({
      acceptedAt: { fromInclusive: "2026-08-06T05:00:00-07:00" },
    }).acceptedAt).toEqual({ fromInclusive: "2026-08-06T12:00:00.000Z" });
  });

  it("rejects reversed time bounds and result limits above the hard cap", () => {
    expect(QueryMemoryInputSchema.safeParse({
      acceptedAt: {
        fromInclusive: "2026-09-01T00:00:00.000Z",
        toExclusive: "2026-08-01T00:00:00.000Z",
      },
    }).success).toBe(false);
    expect(QueryMemoryInputSchema.safeParse({ limit: 26 }).success).toBe(false);
  });

  it("locks the scan, result, excerpt, and aggregate UTF-16 budgets", () => {
    expect(DYNAMIC_MEMORY_QUERY_HARD_LIMIT).toBe(25);
    expect(DYNAMIC_MEMORY_QUERY_SCAN_LIMIT).toBe(500);
    expect(DYNAMIC_MEMORY_QUERY_RESULT_MAX_UTF16).toBe(8_000);
    expect(DYNAMIC_MEMORY_SOURCE_EXCERPT_MAX_UTF16).toBe(300);
  });

  it("keeps deferred subject labels out of the model-facing query schema", () => {
    expect(ModelQueryMemoryInputSchema.safeParse({ subjectLabels: ["Grandparent"] }).success).toBe(false);
    const parsed = ModelQueryMemoryInputSchema.parse({ textTerms: ["folder"] });
    expect(parsed).not.toHaveProperty("subjectLabels");
    expect(parsed).toMatchObject({
      textTerms: ["folder"],
      order: "NEWEST_FIRST",
      limit: 10,
    });
  });

  it("accepts typed complete, incomplete, and fail-closed query outcomes", () => {
    expect(QueryMemoryResultSchema.parse({
      kind: "RESULT",
      complete: false,
      incompleteReasons: ["SOURCE_EXCERPT_UNAVAILABLE"],
      records: [],
    })).toMatchObject({ complete: false });
    expect(QueryMemoryResultSchema.safeParse({
      kind: "RESULT",
      complete: true,
      incompleteReasons: ["SCAN_LIMIT_REACHED"],
      records: [],
    }).success).toBe(false);
    expect(QueryMemoryResultSchema.parse({
      kind: "REJECTED",
      code: "WORKSPACE_SCOPE_UNCERTAIN",
    })).toEqual({ kind: "REJECTED", code: "WORKSPACE_SCOPE_UNCERTAIN" });
  });
});
