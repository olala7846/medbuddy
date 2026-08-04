import { describe, expect, it } from "vitest";
import {
  CompactionSegmentSchema,
  SourceEventSchema,
  type CompactionSegment,
  type SourceEvent,
} from "@medbuddy/contracts";

import {
  createReadySegment,
  deterministicCompactionJobId,
  orderedSourceDigest,
  planHigherLevelCompaction,
  planLevelOneCompaction,
  validateSummaryAgainstProjection,
} from "../src/compaction.js";
import { projectEffectiveConversation } from "../src/conversation-continuity.js";

function source(sequence: number, body = "x".repeat(5_000)): SourceEvent {
  return SourceEventSchema.parse({
    id: `source-event:fictional-${sequence}`,
    workspaceId: "workspace:orchard",
    sourceSequence: sequence,
    occurredAt: `2026-08-04T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    acceptedAt: `2026-08-04T12:00:${String(sequence).padStart(2, "0")}.500Z`,
    providerMessageId: `message:fictional-${sequence}`,
    authorMemberId: "member:fictional-a",
    payload: { kind: "TEXT", body, replyRequested: false },
  });
}

function ready(first: number, last: number, suffix: string): CompactionSegment {
  const summary = { overview: `Fictional ${suffix}.`, keyEvents: [], openLoops: [], caveats: [] };
  return CompactionSegmentSchema.parse({
    id: `compaction-segment:${suffix}`,
    workspaceId: "workspace:orchard",
    level: 1,
    firstSourceSequence: first,
    lastSourceSequence: last,
    sourceCount: last - first + 1,
    orderedSourceDigest: "a".repeat(64),
    childSegmentIds: [],
    modelId: "gemini-3.6-flash",
    promptVersion: "continuity-summary-v1",
    policyVersion: "continuity-v1",
    createdAt: "2026-08-04T12:10:00.000Z",
    inputCharacters: 10,
    outputCharacters: JSON.stringify(summary).length,
    status: "READY",
    summary,
  });
}

describe("level-one compaction planning", () => {
  it("does not plan at or below 20,000 rendered units", () => {
    expect(planLevelOneCompaction("workspace:orchard" as never, [source(1, "x".repeat(19_000))], [])).toBeNull();
  });

  it("selects the oldest complete source range that leaves at most 10,000 recent units", () => {
    const sources = [source(1), source(2), source(3), source(4), source(5)];
    const plan = planLevelOneCompaction("workspace:orchard" as never, sources, []);
    expect(plan).toMatchObject({ level: 1, firstSourceSequence: 1, lastSourceSequence: 4, sourceCount: 4 });
    const remaining = projectEffectiveConversation("workspace:orchard" as never, sources)
      .filter((turn) => turn.sourceSequence > plan!.lastSourceSequence);
    expect(remaining.map((turn) => `[${turn.authorMemberId} | source ${turn.sourceSequence}]\n${turn.body}`).join("\n\n").length)
      .toBeLessThanOrEqual(10_000);
  });

  it("uses ordered content-sensitive digests and stable policy-scoped job identities", () => {
    const sources = [source(1, "Fictional A"), source(2, "Fictional B")];
    const first = orderedSourceDigest("continuity-v1", sources);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(orderedSourceDigest("continuity-v1", [...sources].reverse())).not.toBe(first);
    expect(orderedSourceDigest("continuity-v2", sources)).not.toBe(first);
    expect(deterministicCompactionJobId({
      workspaceId: "workspace:orchard" as never,
      level: 1,
      firstSourceSequence: 1,
      lastSourceSequence: 2,
      policyVersion: "continuity-v1",
    })).toBe(deterministicCompactionJobId({
      workspaceId: "workspace:orchard" as never,
      level: 1,
      firstSourceSequence: 1,
      lastSourceSequence: 2,
      policyVersion: "continuity-v1",
    }));
  });
});

describe("hierarchical compaction and publication validation", () => {
  it("merges exactly four adjacent complete children through a generic next-level plan", () => {
    const children = [ready(1, 2, "a"), ready(3, 4, "b"), ready(5, 6, "c"), ready(7, 8, "d")];
    expect(planHigherLevelCompaction("workspace:orchard" as never, children)).toMatchObject({
      level: 2,
      firstSourceSequence: 1,
      lastSourceSequence: 8,
      childSegmentIds: children.map((child) => child.id),
    });
    expect(planHigherLevelCompaction("workspace:orchard" as never, [children[0]!, children[1]!, ready(6, 7, "gap"), children[3]!])).toBeNull();
  });

  it("rejects unverifiable excerpts, extra source references, and stale digests", () => {
    const sources = [source(1, "A fictional exact sentence.")];
    const projection = projectEffectiveConversation("workspace:orchard" as never, sources);
    const valid = {
      overview: "A participant reported fictional activity.",
      keyEvents: [{ text: "An attributed report.", sourceSequence: 1, verbatimExcerpt: { text: "fictional exact", sourceSequence: 1 } }],
      openLoops: [],
      caveats: ["This is derived and non-authoritative."],
    };
    expect(validateSummaryAgainstProjection(valid, projection)).toEqual(valid);
    expect(() => validateSummaryAgainstProjection({
      ...valid,
      keyEvents: [{ text: "Bad quote.", sourceSequence: 1, verbatimExcerpt: { text: "not in source", sourceSequence: 1 } }],
    }, projection)).toThrow(/excerpt/i);
    expect(() => createReadySegment({
      plan: planLevelOneCompaction("workspace:orchard" as never, [source(1, "x".repeat(21_000)), source(2, "tail")], [])!,
      currentSources: [source(1, "changed"), source(2, "tail")],
      summary: valid,
      modelId: "gemini-3.6-flash",
      promptVersion: "continuity-summary-v1",
      createdAt: "2026-08-04T12:10:00.000Z",
    })).toThrow(/stale/i);
  });
});
