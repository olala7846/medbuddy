import { describe, expect, it } from "vitest";
import {
  COMPACTION_INPUT_MAX_UTF16,
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
  renderBoundedCompactionInput,
  validateSummaryAgainstProjection,
} from "../src/compaction.js";
import { projectEffectiveConversation, renderProjectedTurn } from "../src/conversation-continuity.js";

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

  it("plans and bounds a single accepted 100,000-character turn", () => {
    const plan = planLevelOneCompaction("workspace:orchard" as never, [source(1, "x".repeat(100_000))], []);
    expect(plan).toMatchObject({ firstSourceSequence: 1, lastSourceSequence: 1, sourceCount: 1 });
    expect(plan!.inputCharacters).toBe(COMPACTION_INPUT_MAX_UTF16);
    const bounded = renderBoundedCompactionInput(renderProjectedTurn(
      projectEffectiveConversation("workspace:orchard" as never, [source(1, "x".repeat(100_000))])[0]!,
    ));
    expect(bounded).toHaveLength(COMPACTION_INPUT_MAX_UTF16);
    expect(bounded).toMatch(/UTF-16 CODE UNITS OMITTED FROM COMPACTION INPUT/);
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

  it.each(["TEXT_EDIT", "UNSEND"] as const)(
    "rejects publication when a later %s mutates a source inside the active range",
    (kind) => {
      const original = source(1, "x".repeat(21_000));
      const tail = source(2, "Fictional tail.");
      const plan = planLevelOneCompaction("workspace:orchard" as never, [original, tail], [])!;
      const mutation = SourceEventSchema.parse({
        ...source(3, "ignored"),
        providerMessageId: kind === "TEXT_EDIT" ? "message:fictional-edit" : undefined,
        payload: kind === "TEXT_EDIT"
          ? { kind, targetMessageId: original.providerMessageId, body: "Corrected fictional evidence." }
          : { kind, targetMessageId: original.providerMessageId },
      });

      expect(() => createReadySegment({
        plan,
        currentSources: [original, tail, mutation],
        summary: { overview: "Stale fictional summary.", keyEvents: [], openLoops: [], caveats: [] },
        modelId: "gemini-3.6-flash",
        promptVersion: "continuity-summary-v1",
        createdAt: "2026-08-04T12:10:00.000Z",
      })).toThrow(/stale/i);
    },
  );

  it("replans an edited active range with a new digest and validates against the corrected projection", () => {
    const original = source(1, "x".repeat(21_000));
    const tail = source(2, "Fictional tail.");
    const initial = planLevelOneCompaction("workspace:orchard" as never, [original, tail], [])!;
    const edit = SourceEventSchema.parse({
      ...source(3, "ignored"),
      providerMessageId: "message:fictional-edit",
      payload: { kind: "TEXT_EDIT", targetMessageId: original.providerMessageId, body: "Corrected fictional evidence.".repeat(1_000) },
    });
    const refreshed = planLevelOneCompaction("workspace:orchard" as never, [original, tail, edit], [])!;
    expect(refreshed.orderedSourceDigest).not.toBe(initial.orderedSourceDigest);
    expect(refreshed.id).not.toBe(initial.id);

    expect(createReadySegment({
      plan: refreshed,
      currentSources: [original, tail, edit],
      summary: {
        overview: "Corrected fictional evidence was reported.",
        keyEvents: [{
          text: "A correction was reported.",
          sourceSequence: 1,
          verbatimExcerpt: { text: "Corrected fictional evidence.", sourceSequence: 1 },
        }],
        openLoops: [],
        caveats: [],
      },
      modelId: "gemini-3.6-flash",
      promptVersion: "continuity-summary-v1",
      createdAt: "2026-08-04T12:10:00.000Z",
    })).toMatchObject({ orderedSourceDigest: refreshed.orderedSourceDigest });
  });
});
