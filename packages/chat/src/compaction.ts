import { createHash } from "node:crypto";

import {
  COMPACTION_MERGE_FAN_IN,
  COMPACTION_INPUT_MAX_UTF16,
  CompactionJobIdSchema,
  CompactionSegmentSchema,
  type CompactionSegment,
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
import {
  DEFAULT_CONTINUITY_POLICY,
  type ContinuityPolicy,
} from "./continuity-policy.js";

export { VERIFICATION_SMALL_CONTINUITY_POLICY } from "./continuity-policy.js";

export const COMPACTION_POLICY_VERSION = DEFAULT_CONTINUITY_POLICY.policyVersion;
export const COMPACTION_PROMPT_VERSION = "continuity-summary-v1";
const COMPACTION_OMISSION_LABEL = "UTF-16 CODE UNITS OMITTED FROM COMPACTION INPUT";

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
  orderedSourceDigest?: string;
}) {
  const digest = sha256(JSON.stringify(input));
  return CompactionJobIdSchema.parse(`compaction-job:${digest}`);
}

export function sourceEventsForCompactionRange(
  events: readonly SourceEvent[],
  firstSourceSequence: number,
  lastSourceSequence: number,
): SourceEvent[] {
  const ordered = [...events].sort((left, right) => left.sourceSequence - right.sourceSequence);
  const base = ordered.filter((event) =>
    event.sourceSequence >= firstSourceSequence && event.sourceSequence <= lastSourceSequence);
  const targetMessageIds = new Set<string>(base.flatMap((event) =>
    event.providerMessageId === undefined ? [] : [event.providerMessageId]));
  const laterMutations = ordered.filter((event) =>
    event.sourceSequence > lastSourceSequence &&
    (event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND") &&
    targetMessageIds.has(event.payload.targetMessageId));
  return [...base, ...laterMutations];
}

export function projectCompactionRange(
  workspaceId: WorkspaceId,
  events: readonly SourceEvent[],
  firstSourceSequence: number,
  lastSourceSequence: number,
): ProjectedTurn[] {
  const sources = sourceEventsForCompactionRange(events, firstSourceSequence, lastSourceSequence);
  const baseCoordinates = new Map<string, SourceEvent>(sources
    .filter((event) => event.sourceSequence <= lastSourceSequence && event.providerMessageId !== undefined)
    .map((event) => [event.providerMessageId!, event]));
  return projectEffectiveConversation(workspaceId, sources)
    .map((turn) => {
      const base = turn.providerMessageId === undefined ? undefined : baseCoordinates.get(turn.providerMessageId);
      return base === undefined ? turn : {
        ...turn,
        sourceEventId: base.id,
        sourceSequence: base.sourceSequence,
        authorMemberId: base.authorMemberId,
      };
    })
    .filter((turn) => turn.sourceSequence >= firstSourceSequence && turn.sourceSequence <= lastSourceSequence)
    .sort((left, right) => left.sourceSequence - right.sourceSequence);
}

export function renderBoundedCompactionInput(renderedInput: string): string {
  if (renderedInput.length <= COMPACTION_INPUT_MAX_UTF16) return renderedInput;
  const initialMarker = `\n\n[000000 ${COMPACTION_OMISSION_LABEL}]\n\n`;
  const initialBudget = COMPACTION_INPUT_MAX_UTF16 - initialMarker.length;
  const initialHead = Math.ceil(initialBudget / 2);
  const initialTail = Math.floor(initialBudget / 2);
  const omitted = renderedInput.length - initialHead - initialTail;
  const marker = `\n\n[${omitted} ${COMPACTION_OMISSION_LABEL}]\n\n`;
  const contentBudget = COMPACTION_INPUT_MAX_UTF16 - marker.length;
  const head = Math.ceil(contentBudget / 2);
  const tail = Math.floor(contentBudget / 2);
  return `${renderedInput.slice(0, head)}${marker}${renderedInput.slice(-tail)}`;
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
  policy: ContinuityPolicy = DEFAULT_CONTINUITY_POLICY,
): CompactionPlan | null {
  const policyVersion = policy.policyVersion;
  for (const event of sourceEvents) {
    if (event.workspaceId !== workspaceId) throw new Error("Compaction planning cannot cross a workspace boundary.");
  }
  for (const segment of readySegments) {
    if (segment.workspaceId !== workspaceId) throw new Error("Compaction coverage cannot cross a workspace boundary.");
  }
  const coverage = Math.max(0, ...readySegments
    .filter((segment) => segment.level === 1 && segment.policyVersion === policyVersion)
    .map((segment) => segment.lastSourceSequence));
  const eligibleSources = [...sourceEvents]
    .filter((event) => event.sourceSequence > coverage)
    .sort((left, right) => left.sourceSequence - right.sourceSequence);
  const projected = projectEffectiveConversation(workspaceId, eligibleSources);
  if (renderedLength(projected) <= policy.compactionTriggerUtf16) return null;

  const retained: ProjectedTurn[] = [];
  for (const turn of [...projected].reverse()) {
    const candidate = [turn, ...retained];
    if (renderedLength(candidate) > policy.protectedRecentMaxUtf16) break;
    retained.unshift(turn);
  }
  const earliestRetained = retained[0]?.sourceSequence;
  const firstSourceSequence = eligibleSources[0]?.sourceSequence;
  const lastSourceSequenceValue = earliestRetained === undefined
    ? eligibleSources.at(-1)?.sourceSequence
    : earliestRetained - 1;
  if (lastSourceSequenceValue === undefined) return null;
  const lastSourceSequence = lastSourceSequenceValue;
  if (firstSourceSequence === undefined || lastSourceSequence < firstSourceSequence) return null;
  const coveredSources = eligibleSources.filter((event) => event.sourceSequence <= lastSourceSequence);
  if (coveredSources.length === 0) return null;
  const digestSources = sourceEventsForCompactionRange(sourceEvents, firstSourceSequence, lastSourceSequence);
  const orderedDigest = orderedSourceDigest(policyVersion, digestSources);
  const renderedInput = renderBoundedCompactionInput(projectCompactionRange(
    workspaceId,
    sourceEvents,
    firstSourceSequence,
    lastSourceSequence,
  ).map(renderProjectedTurn).join("\n\n"));
  return {
    id: deterministicCompactionJobId({ workspaceId, level: 1, firstSourceSequence, lastSourceSequence, policyVersion, orderedSourceDigest: orderedDigest }),
    workspaceId,
    level: 1,
    firstSourceSequence,
    lastSourceSequence,
    sourceCount: coveredSources.length,
    orderedSourceDigest: orderedDigest,
    childSegmentIds: [],
    policyVersion,
    inputCharacters: renderedInput.length,
  };
}

export function planHigherLevelCompaction(
  workspaceId: WorkspaceId,
  readySegments: readonly CompactionSegment[],
  policy: ContinuityPolicy = DEFAULT_CONTINUITY_POLICY,
): CompactionPlan | null {
  const policyVersion = policy.policyVersion;
  for (const segment of readySegments) {
    if (segment.workspaceId !== workspaceId) throw new Error("Higher-level planning cannot cross a workspace boundary.");
  }
  const policySegments = readySegments.filter((segment) => segment.policyVersion === policyVersion);
  const parented = new Set(policySegments.flatMap((segment) => segment.childSegmentIds));
  const unparented = policySegments.filter((segment) => !parented.has(segment.id));
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
  const rangeSources = sourceEventsForCompactionRange(
    input.currentSources,
    input.plan.firstSourceSequence,
    input.plan.lastSourceSequence,
  );
  if (rangeSources.some((event) => event.workspaceId !== input.plan.workspaceId)) {
    throw new Error("Segment publication cannot cross a workspace boundary.");
  }
  if (input.plan.level === 1 && orderedSourceDigest(input.plan.policyVersion, rangeSources) !== input.plan.orderedSourceDigest) {
    throw new Error("Compaction candidate is stale because the ordered projection digest changed.");
  }
  const projection = input.plan.level === 1
    ? projectCompactionRange(
        input.plan.workspaceId,
        input.currentSources,
        input.plan.firstSourceSequence,
        input.plan.lastSourceSequence,
      )
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
