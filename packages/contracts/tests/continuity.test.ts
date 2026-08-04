import { describe, expect, it } from "vitest";

import {
  AgentActionContextSchema,
  CompactionJobSchema,
  CompactionSegmentSchema,
  ContinuityAttachmentSchema,
  SourceEventSchema,
} from "../src/continuity.js";

const baseEvent = {
  id: "source-event:fictional-1",
  workspaceId: "workspace:orchard",
  sourceSequence: 1,
  occurredAt: "2026-08-04T12:00:00.000Z",
  acceptedAt: "2026-08-04T12:00:01.000Z",
  providerMessageId: "message:fictional-1",
  authorMemberId: "member:fictional-1",
  payload: { kind: "TEXT", body: "A fictional family update.", replyRequested: true },
} as const;

describe("continuity contracts", () => {
  it("admits exactly 100,000 UTF-16 code units and rejects one more", () => {
    expect(SourceEventSchema.safeParse({
      ...baseEvent,
      payload: { kind: "TEXT", body: "😀".repeat(50_000), replyRequested: true },
    }).success).toBe(true);
    expect(SourceEventSchema.safeParse({
      ...baseEvent,
      payload: { kind: "TEXT", body: `${"😀".repeat(50_000)}x`, replyRequested: true },
    }).success).toBe(false);
  });

  it("rejects malformed ranges, attempts, and non-ready segments", () => {
    expect(CompactionJobSchema.safeParse({
      id: "compaction-job:fictional-1",
      workspaceId: "workspace:orchard",
      level: 1,
      firstSourceSequence: 4,
      lastSourceSequence: 3,
      orderedSourceDigest: "a".repeat(64),
      childSegmentIds: [],
      policyVersion: "continuity-v1",
      status: "PENDING",
      attempts: 0,
      createdAt: "2026-08-04T12:00:00.000Z",
    }).success).toBe(false);
    expect(ContinuityAttachmentSchema.safeParse({
      id: "attachment:fictional-1",
      workspaceId: "workspace:orchard",
      sourceEventId: "source-event:fictional-1",
      mediaClass: "PDF",
      state: "PENDING",
      attempts: 4,
    }).success).toBe(false);
    expect(CompactionSegmentSchema.safeParse({ status: "GENERATING" }).success).toBe(false);
  });

  it("requires same-workspace action references", () => {
    expect(() => AgentActionContextSchema.parse({
      workspaceId: "workspace:orchard",
      items: [{
        workspaceId: "workspace:other",
        sourceEventId: "source-event:fictional-1",
        kind: "SYSTEM_OUTCOME",
        outcome: { kind: "FICTIONAL" },
      }],
    })).toThrow(/workspace/i);
  });

  it("accepts only the exact bounded four-field summary shape", () => {
    const summary = { overview: "Fictional overview.", keyEvents: [], openLoops: [], caveats: [] } as const;
    const segment = {
      id: "compaction-segment:fictional-1",
      workspaceId: "workspace:orchard",
      level: 1,
      firstSourceSequence: 1,
      lastSourceSequence: 2,
      sourceCount: 2,
      orderedSourceDigest: "a".repeat(64),
      childSegmentIds: [],
      modelId: "gemini-3.6-flash",
      promptVersion: "continuity-summary-v1",
      policyVersion: "continuity-v1",
      createdAt: "2026-08-04T12:00:00.000Z",
      inputCharacters: 100,
      outputCharacters: JSON.stringify(summary).length,
      status: "READY",
      summary,
    } as const;
    expect(CompactionSegmentSchema.parse(segment)).toEqual(segment);
    expect(CompactionSegmentSchema.safeParse({
      ...segment,
      summary: { ...segment.summary, extra: "not allowed" },
    }).success).toBe(false);
  });
});
