import { createHash } from "node:crypto";

import {
  COMPACTION_MERGE_FAN_IN,
  COMPACTION_TRIGGER_UTF16,
  CompactionJobIdSchema,
  CompactionSegmentSchema,
  type CompactionSegment,
  PROTECTED_RECENT_MAX_UTF16,
  SegmentSummarySchema,
  type SegmentSummary,
  type SourceEvent,
  type WorkspaceId,
} from "@medbuddy/contracts";

import {
  projectEffectiveConversation,
  renderProjectedTurn,
  type ProjectedTurn,
} from "./conversation-continuity.js";

export const COMPACTION_POLICY_VERSION = "continuity-v1";
export const COMPACTION_PROMPT_VERSION = "continuity-summary-v1";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function payloadDigest(event: SourceEvent): string {
  switch (event.payload.kind) {
    case "TEXT":
      return sha256(event.payload.body);
    case "TEXT_EDIT":
      return sha256(`${event.payload.targetMessageId}\u0000${event.payload.body}`);
    case "UNSEND":
      return sha256(event.payload.targetMessageId);
    case "ATTACHMENT":
      return sha256(`${event.payload.attachmentId}\u0000${event.payload.mediaClass}`);
  }
}

/** Hashes canonical coordinates and content digests without retaining raw content. */
export function orderedSourceDigest(policyVersion: string, events: readonly SourceEvent[]): string {
  const canonical = events.map((event) => ({
    id: event.id,
    workspaceId: event.workspaceId,
    sourceSequence: event.sourceSequence,
    kind: event.payload.kind,
    authorMemberId: event.authorMemberId,
    providerMessageId: event.providerMessageId ?? null,
    payloadDigest: payloadDigest(event),
  }));
  return sha256(JSON.stringify({ policyVersion, sources: canonical }));
}

export function deterministicCompactionJobId(input: {
  workspaceId: WorkspaceId;
  level: number;
  firstSourceSequence: number;
  lastSourceSequence: number;
  policyVersion: string;
}) {
  const digest = sha256(JSON.stringify(input));
  return CompactionJobIdSchema.parse(`compaction-job:${digest}`);
}

export type CompactionPlan = {
  id: ReturnType<typeof deterministicCompactionJobId>;
  workspaceId: WorkspaceId;
  level: number;
  firstSourceSequence: number;
  lastSourceSequence: number;
  sourceCount: number;
  orderedSourceDigest: string;
  childSegmentIds: CompactionSegment["childSegmentIds"];
  policyVersion: string;
  inputCharacters: number;
};

function renderedLength(turns: readonly ProjectedTurn[]): number {
  return turns.map(renderProjectedTurn).join("\n\n").length;
}

export function planLevelOneCompaction(
  workspaceId: WorkspaceId,
  sourceEvents: readonly SourceEvent[],
  readySegments: readonly CompactionSegment[],
  policyVersion = COMPACTION_POLICY_VERSION,
): CompactionPlan | null {
  for (const event of sourceEvents) {
    if (event.workspaceId !== workspaceId) throw new Error("Compaction planning cannot cross a workspace boundary.");
  }
  for (const segment of readySegments) {
    if (segment.workspaceId !== workspaceId) throw new Error("Compaction coverage cannot cross a workspace boundary.");
  }
  const coverage = Math.max(0, ...readySegments
    .filter((segment) => segment.level === 1)
    .map((segment) => segment.lastSourceSequence));
  const eligibleSources = [...sourceEvents]
    .filter((event) => event.sourceSequence > coverage)
    .sort((left, right) => left.sourceSequence - right.sourceSequence);
  const projected = projectEffectiveConversation(workspaceId, eligibleSources);
  if (renderedLength(projected) <= COMPACTION_TRIGGER_UTF16) return null;

  const retained: ProjectedTurn[] = [];
  for (const turn of [...projected].reverse()) {
    const candidate = [turn, ...retained];
    if (retained.length > 0 && renderedLength(candidate) > PROTECTED_RECENT_MAX_UTF16) break;
    retained.unshift(turn);
    if (renderedLength(retained) > PROTECTED_RECENT_MAX_UTF16) break;
  }
  const earliestRetained = retained[0]?.sourceSequence;
  if (earliestRetained === undefined) return null;
  const firstSourceSequence = eligibleSources[0]?.sourceSequence;
  const lastSourceSequence = earliestRetained - 1;
  if (firstSourceSequence === undefined || lastSourceSequence < firstSourceSequence) return null;
  const coveredSources = eligibleSources.filter((event) => event.sourceSequence <= lastSourceSequence);
  if (coveredSources.length === 0) return null;
  const orderedDigest = orderedSourceDigest(policyVersion, coveredSources);
  return {
    id: deterministicCompactionJobId({ workspaceId, level: 1, firstSourceSequence, lastSourceSequence, policyVersion }),
    workspaceId,
    level: 1,
    firstSourceSequence,
    lastSourceSequence,
    sourceCount: coveredSources.length,
    orderedSourceDigest: orderedDigest,
    childSegmentIds: [],
    policyVersion,
    inputCharacters: renderedLength(projected.filter((turn) => turn.sourceSequence <= lastSourceSequence)),
  };
}

export function planHigherLevelCompaction(
  workspaceId: WorkspaceId,
  readySegments: readonly CompactionSegment[],
  policyVersion = COMPACTION_POLICY_VERSION,
): CompactionPlan | null {
  for (const segment of readySegments) {
    if (segment.workspaceId !== workspaceId) throw new Error("Higher-level planning cannot cross a workspace boundary.");
  }
  const parented = new Set(readySegments.flatMap((segment) => segment.childSegmentIds));
  const unparented = readySegments.filter((segment) => !parented.has(segment.id));
  const levels = [...new Set(unparented.map((segment) => segment.level))].sort((left, right) => left - right);
  for (const level of levels) {
    const candidates = unparented
      .filter((segment) => segment.level === level)
      .sort((left, right) => left.firstSourceSequence - right.firstSourceSequence);
    for (let start = 0; start <= candidates.length - COMPACTION_MERGE_FAN_IN; start += 1) {
      const children = candidates.slice(start, start + COMPACTION_MERGE_FAN_IN);
      const adjacent = children.every((child, index) =>
        index === 0 || children[index - 1]!.lastSourceSequence + 1 === child.firstSourceSequence);
      if (!adjacent) continue;
      const firstSourceSequence = children[0]!.firstSourceSequence;
      const lastSourceSequence = children.at(-1)!.lastSourceSequence;
      const nextLevel = level + 1;
      const digest = sha256(JSON.stringify({
        policyVersion,
        children: children.map((child) => ({ id: child.id, digest: child.orderedSourceDigest, summary: child.summary })),
      }));
      return {
        id: deterministicCompactionJobId({ workspaceId, level: nextLevel, firstSourceSequence, lastSourceSequence, policyVersion }),
        workspaceId,
        level: nextLevel,
        firstSourceSequence,
        lastSourceSequence,
        sourceCount: children.reduce((total, child) => total + child.sourceCount, 0),
        orderedSourceDigest: digest,
        childSegmentIds: children.map((child) => child.id),
        policyVersion,
        inputCharacters: children.reduce((total, child) => total + child.outputCharacters, 0),
      };
    }
  }
  return null;
}

export function validateSummaryAgainstProjection(
  value: unknown,
  projection: readonly ProjectedTurn[],
): SegmentSummary {
  const summary = SegmentSummarySchema.parse(value);
  const bySequence = new Map(projection.map((turn) => [turn.sourceSequence, turn]));
  for (const event of summary.keyEvents) {
    if (event.sourceSequence !== undefined && !bySequence.has(event.sourceSequence)) {
      throw new Error("Summary references a source sequence outside the candidate projection.");
    }
    if (event.verbatimExcerpt !== undefined) {
      const source = bySequence.get(event.verbatimExcerpt.sourceSequence);
      if (source === undefined || !source.body.includes(event.verbatimExcerpt.text)) {
        throw new Error("Summary excerpt is not an exact match in its referenced projected source.");
      }
    }
  }
  return summary;
}

export function createReadySegment(input: {
  plan: CompactionPlan;
  currentSources: readonly SourceEvent[];
  summary: unknown;
  modelId: string;
  promptVersion: string;
  createdAt: string;
}): CompactionSegment {
  const rangeSources = [...input.currentSources]
    .filter((event) => event.sourceSequence >= input.plan.firstSourceSequence && event.sourceSequence <= input.plan.lastSourceSequence)
    .sort((left, right) => left.sourceSequence - right.sourceSequence);
  if (rangeSources.some((event) => event.workspaceId !== input.plan.workspaceId)) {
    throw new Error("Segment publication cannot cross a workspace boundary.");
  }
  if (input.plan.level === 1 && orderedSourceDigest(input.plan.policyVersion, rangeSources) !== input.plan.orderedSourceDigest) {
    throw new Error("Compaction candidate is stale because the ordered projection digest changed.");
  }
  const projection = input.plan.level === 1
    ? projectEffectiveConversation(input.plan.workspaceId, rangeSources)
    : [];
  const summary = input.plan.level === 1
    ? validateSummaryAgainstProjection(input.summary, projection)
    : SegmentSummarySchema.parse(input.summary);
  const outputCharacters = JSON.stringify(summary).length;
  return CompactionSegmentSchema.parse({
    id: `compaction-segment:${input.plan.id.slice("compaction-job:".length)}`,
    workspaceId: input.plan.workspaceId,
    level: input.plan.level,
    firstSourceSequence: input.plan.firstSourceSequence,
    lastSourceSequence: input.plan.lastSourceSequence,
    sourceCount: input.plan.sourceCount,
    orderedSourceDigest: input.plan.orderedSourceDigest,
    childSegmentIds: input.plan.childSegmentIds,
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    policyVersion: input.plan.policyVersion,
    createdAt: input.createdAt,
    inputCharacters: input.plan.inputCharacters,
    outputCharacters,
    status: "READY",
    summary,
  });
}
