import { describe, expect, it } from "vitest";
import {
  AGENT_ACTION_MAX_UTF16,
  ASSEMBLED_CONTEXT_MAX_UTF16,
  AgentActionContextSchema,
  CompactionSegmentSchema,
  ContinuityAttachmentSchema,
  SourceEventSchema,
  type SourceEvent,
} from "@medbuddy/contracts";

import {
  assembleConversationContext,
  projectEffectiveConversation,
  renderProjectedTurn,
} from "../src/conversation-continuity.js";
import { VERIFICATION_SMALL_CONTINUITY_POLICY } from "../src/compaction.js";

function event(sequence: number, body: string, overrides: Record<string, unknown> = {}): SourceEvent {
  return SourceEventSchema.parse({
    id: `source-event:fictional-${sequence}`,
    workspaceId: "workspace:orchard",
    sourceSequence: sequence,
    occurredAt: `2026-08-04T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    acceptedAt: `2026-08-04T12:00:${String(sequence).padStart(2, "0")}.500Z`,
    providerMessageId: `message:fictional-${sequence}`,
    authorMemberId: "member:fictional-a",
    payload: { kind: "TEXT", body, replyRequested: sequence === 1 },
    ...overrides,
  });
}

function segment(input: { id: string; level: number; first: number; last: number; children?: string[]; summaryText?: string; policyVersion?: string }) {
  const summary = { overview: input.summaryText ?? `Fictional history ${input.first}-${input.last}.`, keyEvents: [], openLoops: [], caveats: [] };
  return CompactionSegmentSchema.parse({
    id: `compaction-segment:${input.id}`,
    workspaceId: "workspace:orchard",
    level: input.level,
    firstSourceSequence: input.first,
    lastSourceSequence: input.last,
    sourceCount: input.last - input.first + 1,
    orderedSourceDigest: "a".repeat(64),
    childSegmentIds: (input.children ?? []).map((id) => `compaction-segment:${id}`),
    modelId: "gemini-3.6-flash",
    promptVersion: "continuity-summary-v1",
    policyVersion: input.policyVersion ?? "continuity-v1",
    createdAt: "2026-08-04T12:05:00.000Z",
    inputCharacters: 100,
    outputCharacters: JSON.stringify(summary).length,
    status: "READY",
    summary,
  });
}

describe("effective conversation projection", () => {
  it("uses the newest edit and removes a later unsent target without mutating sources", () => {
    const original = event(1, "Original fictional note.");
    const edited = event(2, "Edited fictional note.", {
      providerMessageId: "message:fictional-edit",
      payload: { kind: "TEXT_EDIT", targetMessageId: original.providerMessageId, body: "Corrected fictional note." },
    });
    const other = event(3, "Another fictional note.");
    const unsend = event(4, "ignored", {
      providerMessageId: undefined,
      payload: { kind: "UNSEND", targetMessageId: other.providerMessageId },
    });
    const sources = [original, edited, other, unsend];

    expect(projectEffectiveConversation("workspace:orchard" as never, sources)).toMatchObject([
      { sourceSequence: 2, body: "Corrected fictional note.", projectionStatus: "EDITED" },
    ]);
    expect(sources[0]).toEqual(original);
  });

  it("renders attachment availability markers without byte or object metadata", () => {
    const source = event(1, "ignored", {
      providerMessageId: undefined,
      payload: { kind: "ATTACHMENT", attachmentId: "attachment:fictional-1", mediaClass: "PDF" },
    });
    const [turn] = projectEffectiveConversation("workspace:orchard" as never, [source], [ContinuityAttachmentSchema.parse({
      id: "attachment:fictional-1",
      workspaceId: "workspace:orchard",
      sourceEventId: source.id,
      mediaClass: "PDF",
      state: "AVAILABLE",
      byteSize: 12,
      checksum: "a".repeat(64),
      attempts: 1,
    })]);
    expect(renderProjectedTurn(turn!)).toContain("[PDF attachment available]");
    expect(renderProjectedTurn(turn!)).not.toContain("checksum");
  });
});

describe("deterministic conversation context", () => {
  it("renders historical segments only from the active policy version", () => {
    const sources = [event(3, "Current fictional focal.")];
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: sources[0]!.id,
      sourceEvents: sources,
      readySegments: [
        segment({ id: "production", level: 1, first: 1, last: 1, summaryText: "PRODUCTION_ONLY" }),
        segment({
          id: "verification",
          level: 1,
          first: 2,
          last: 2,
          summaryText: "VERIFICATION_ONLY",
          policyVersion: "continuity-v1-verification-small",
        }),
      ],
      system: "SYSTEM SAFETY",
      compactionPending: false,
      policy: VERIFICATION_SMALL_CONTINUITY_POLICY,
    });
    expect(assembled.history).toContain("VERIFICATION_ONLY");
    expect(assembled.history).not.toContain("PRODUCTION_ONLY");
    expect(assembled.selectedSegments).toHaveLength(1);
  });

  it("uses the verification-small pending ceiling only when explicitly selected", () => {
    const sources = [event(1, "a".repeat(900)), event(2, "b".repeat(900)), event(3, "focal")];
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: sources[2]!.id,
      sourceEvents: sources,
      readySegments: [],
      system: "SYSTEM SAFETY",
      compactionPending: true,
      policy: VERIFICATION_SMALL_CONTINUITY_POLICY,
    });
    expect(assembled.recentConversation.length).toBeLessThanOrEqual(1_800);
    expect(assembled.recentConversation).toContain("OLDER HISTORY IS PENDING COMPACTION");
  });

  it("counts attribution and surrogate pairs in protected whole-turn selection", () => {
    const sources = [event(1, "x".repeat(9_900)), event(2, "😀".repeat(40))];
    const projected = projectEffectiveConversation("workspace:orchard" as never, sources);
    expect(renderProjectedTurn(projected[1]!).length).toBeGreaterThan(80);
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: sources[1]!.id,
      sourceEvents: sources,
      readySegments: [],
      system: "SYSTEM SAFETY",
      compactionPending: false,
    });
    expect(assembled.recentConversation).toContain("😀");
    expect(assembled.recentConversation.length).toBeLessThanOrEqual(20_000);
  });

  it("keeps an oversized focal event through a marked deterministic head/tail excerpt", () => {
    const older = event(1, "Older fictional context.");
    const focal = event(2, "a".repeat(40_000));
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: focal.id,
      sourceEvents: [older, focal],
      readySegments: [],
      system: "SYSTEM SAFETY",
      compactionPending: true,
    });
    expect(assembled.recentConversation).toContain("BEGIN BOUNDED EXCERPT — NOT VERBATIM MESSAGE");
    expect(assembled.recentConversation).toMatch(/OMITTED [1-9][0-9]* UTF-16 CODE UNITS/);
    expect(assembled.recentConversation).toContain("OLDER HISTORY IS PENDING COMPACTION");
    expect(assembled.recentConversation.length).toBeLessThanOrEqual(30_000);
  });

  it("caps pending uncompacted history at 30,000 and inserts one content-free marker", () => {
    const sources = Array.from({ length: 8 }, (_, index) => event(index + 1, `${index}`.repeat(5_000)));
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: sources.at(-1)!.id,
      sourceEvents: sources,
      readySegments: [],
      system: "SYSTEM SAFETY",
      compactionPending: true,
    });
    expect(assembled.recentConversation.length).toBeLessThanOrEqual(30_000);
    expect(assembled.recentConversation.match(/OLDER HISTORY IS PENDING COMPACTION/g)).toHaveLength(1);
    expect(assembled.omittedSourceEventCount).toBeGreaterThan(0);
  });

  it("stops at the first non-fitting older turn instead of creating a temporal gap", () => {
    const sources = [event(1, "old-small"), event(2, "m".repeat(19_990)), event(3, "focal-small")];
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: sources[2]!.id,
      sourceEvents: sources,
      readySegments: [],
      system: "SYSTEM SAFETY",
      compactionPending: false,
    });
    expect(assembled.recentConversation).toContain("focal-small");
    expect(assembled.recentConversation).not.toContain("old-small");
    expect(assembled.recentConversation).toContain("OLDER HISTORY IS PENDING COMPACTION");
  });

  it("bounds the fully wrapped request context and newest historical frontier", () => {
    const focal = event(40, "Fictional focal update.");
    const roots = Array.from({ length: 20 }, (_, index) => segment({
      id: `root-${index}`,
      level: 1,
      first: index * 2 + 1,
      last: index * 2 + 2,
      summaryText: `${index}:`.padEnd(3_500, "h"),
    }));
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: focal.id,
      sourceEvents: [focal],
      readySegments: roots,
      familyMap: { workspaceId: "workspace:orchard" as never, content: "f".repeat(4_000), revision: 1 },
      system: "s".repeat(8_000),
      compactionPending: false,
    });
    expect(assembled.rendered.length).toBeLessThanOrEqual(ASSEMBLED_CONTEXT_MAX_UTF16);
    expect(assembled.selectedSegments.length).toBeLessThan(roots.length);
    expect(assembled.selectedSegments.at(-1)?.id).toBe(roots.at(-2)?.id);
  });

  it("counts action block wrappers and separators inside the 4k action ceiling", () => {
    const focal = event(1, "Fictional focal.");
    const actions = AgentActionContextSchema.parse({
      workspaceId: "workspace:orchard",
      items: [{
        workspaceId: "workspace:orchard",
        sourceEventId: focal.id,
        kind: "SYSTEM_OUTCOME",
        outcome: { detail: "x".repeat(3_900) },
      }],
    });
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: focal.id,
      sourceEvents: [focal],
      readySegments: [],
      agentActions: actions,
      system: "SYSTEM SAFETY",
      compactionPending: false,
    });
    expect(assembled.agentActions?.length ?? 0).toBeLessThanOrEqual(AGENT_ACTION_MAX_UTF16);
  });

  it("renders system, family map, actions, parent frontier, then newer attributed evidence", () => {
    const sources = [event(9, "Newest fictional observation.")];
    const children = [
      segment({ id: "l1-a", level: 1, first: 1, last: 2 }),
      segment({ id: "l1-b", level: 1, first: 3, last: 4 }),
      segment({ id: "l1-c", level: 1, first: 5, last: 6 }),
      segment({ id: "l1-d", level: 1, first: 7, last: 8 }),
    ];
    const parent = segment({ id: "l2", level: 2, first: 1, last: 8, children: ["l1-a", "l1-b", "l1-c", "l1-d"] });
    const actions = AgentActionContextSchema.parse({
      workspaceId: "workspace:orchard",
      items: [{
        workspaceId: "workspace:orchard",
        sourceEventId: sources[0]!.id,
        kind: "SYSTEM_OUTCOME",
        outcome: { kind: "FICTIONAL_REVIEWED" },
      }],
    });
    const assembled = assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: sources[0]!.id,
      sourceEvents: sources,
      familyMap: { workspaceId: "workspace:orchard" as never, content: "Fictional family map.", revision: 1 },
      agentActions: actions,
      readySegments: [...children, parent],
      system: "SYSTEM SAFETY",
      compactionPending: false,
    });
    expect(assembled.rendered).toMatch(/SYSTEM SAFETY[\s\S]*Fictional family map[\s\S]*FICTIONAL_REVIEWED[\s\S]*history 1-8[\s\S]*Newest fictional observation/);
    expect(assembled.rendered).not.toContain("history 1-2");
  });

  it("rejects mixed workspaces and overlapping unrelated history before rendering", () => {
    const focal = event(3, "Fictional focal.");
    expect(() => assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: focal.id,
      sourceEvents: [focal, event(4, "Crossed.", { workspaceId: "workspace:meadow" })],
      readySegments: [],
      system: "SYSTEM SAFETY",
      compactionPending: false,
    })).toThrow(/workspace/i);
    expect(() => assembleConversationContext({
      workspaceId: "workspace:orchard" as never,
      focalSourceEventId: focal.id,
      sourceEvents: [focal],
      readySegments: [
        segment({ id: "a", level: 1, first: 1, last: 2 }),
        segment({ id: "b", level: 1, first: 2, last: 2 }),
      ],
      system: "SYSTEM SAFETY",
      compactionPending: false,
    })).toThrow(/overlap/i);
  });
});
