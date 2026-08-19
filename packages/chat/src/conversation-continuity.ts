import {
  AGENT_ACTION_MAX_UTF16,
  ASSEMBLED_CONTEXT_MAX_UTF16,
  CONTINUITY_POLICIES,
  AgentActionContextSchema,
  AssembledContextSchema,
  type CompactionSegment,
  type ContinuityAttachment,
  type ContinuityPolicy,
  type SourceEvent,
  type SourceEventId,
  type WorkspaceId,
} from "@medbuddy/contracts";

const PENDING_HISTORY_MARKER = "[OLDER HISTORY IS PENDING COMPACTION — OMITTED CONTENT REMAINS STORED]";
const FOCAL_EXCERPT_LABEL = "BEGIN BOUNDED EXCERPT — NOT VERBATIM MESSAGE";
const OMITTED_HISTORY_MARKER = "[OLDER DERIVED HISTORY OMITTED TO FIT THE REQUEST BUDGET]";

function joinBlocks(blocks: readonly (string | undefined)[]): string {
  return blocks.filter((block): block is string => block !== undefined && block.length > 0).join("\n\n");
}

export type ProjectedTurn = {
  workspaceId: WorkspaceId;
  sourceEventId: SourceEventId;
  sourceSequence: number;
  providerMessageId?: string;
  authorMemberId: SourceEvent["authorMemberId"];
  body: string;
  projectionStatus: "ORIGINAL" | "EDITED" | "ATTACHMENT";
};

function attachmentMarker(
  event: SourceEvent & { payload: Extract<SourceEvent["payload"], { kind: "ATTACHMENT" }> },
  attachments: readonly ContinuityAttachment[],
): string {
  const attachment = attachments.find((candidate) =>
    candidate.workspaceId === event.workspaceId && candidate.id === event.payload.attachmentId);
  const state = attachment?.state ?? "PENDING";
  const media = event.payload.mediaClass === "IMAGE" ? "image" : event.payload.mediaClass === "PDF" ? "PDF" : "other";
  return state === "AVAILABLE"
    ? `[${media} attachment available]`
    : state === "FAILED"
      ? `[${media} attachment unavailable]`
      : `[${media} attachment pending]`;
}

export function projectEffectiveConversation(
  workspaceId: WorkspaceId,
  sourceEvents: readonly SourceEvent[],
  attachments: readonly ContinuityAttachment[] = [],
): ProjectedTurn[] {
  for (const event of sourceEvents) {
    if (event.workspaceId !== workspaceId) throw new Error("Source projection cannot cross a workspace boundary.");
  }
  for (const attachment of attachments) {
    if (attachment.workspaceId !== workspaceId) throw new Error("Attachment projection cannot cross a workspace boundary.");
  }

  const messages = new Map<string, ProjectedTurn>();
  const standalone: ProjectedTurn[] = [];
  for (const event of [...sourceEvents].sort((left, right) => left.sourceSequence - right.sourceSequence)) {
    switch (event.payload.kind) {
      case "TEXT": {
        const providerMessageId = event.providerMessageId;
        if (providerMessageId === undefined) throw new Error("Text evidence is missing its provider message ID.");
        messages.set(providerMessageId, {
          workspaceId,
          sourceEventId: event.id,
          sourceSequence: event.sourceSequence,
          providerMessageId,
          authorMemberId: event.authorMemberId,
          body: event.payload.body,
          projectionStatus: "ORIGINAL",
        });
        break;
      }
      case "TEXT_EDIT": {
        const target = messages.get(event.payload.targetMessageId);
        messages.set(event.payload.targetMessageId, {
          workspaceId,
          sourceEventId: event.id,
          sourceSequence: event.sourceSequence,
          providerMessageId: event.payload.targetMessageId,
          authorMemberId: target?.authorMemberId ?? event.authorMemberId,
          body: event.payload.body,
          projectionStatus: "EDITED",
        });
        break;
      }
      case "UNSEND":
        messages.delete(event.payload.targetMessageId);
        break;
      case "ATTACHMENT": {
        const turn: ProjectedTurn = {
          workspaceId,
          sourceEventId: event.id,
          sourceSequence: event.sourceSequence,
          ...(event.providerMessageId === undefined ? {} : { providerMessageId: event.providerMessageId }),
          authorMemberId: event.authorMemberId,
          body: attachmentMarker(event as never, attachments),
          projectionStatus: "ATTACHMENT",
        };
        if (event.providerMessageId === undefined) standalone.push(turn);
        else messages.set(event.providerMessageId, turn);
        break;
      }
    }
  }
  return [...messages.values(), ...standalone]
    .sort((left, right) => left.sourceSequence - right.sourceSequence);
}

export function renderProjectedTurn(turn: ProjectedTurn): string {
  return `[${turn.authorMemberId} | source ${turn.sourceSequence}]\n${turn.body}`;
}

function renderFocalExcerpt(turn: ProjectedTurn, limit: number): string {
  const prefix = `[${turn.authorMemberId} | source ${turn.sourceSequence}]\n${FOCAL_EXCERPT_LABEL}\n`;
  const fixedSuffix = "\nEND BOUNDED EXCERPT";
  const omissionTemplate = "\n[OMITTED 000000 UTF-16 CODE UNITS]\n";
  const contentBudget = Math.max(2, limit - prefix.length - fixedSuffix.length - omissionTemplate.length);
  const headLength = Math.ceil(contentBudget / 2);
  const tailLength = Math.floor(contentBudget / 2);
  const omitted = Math.max(0, turn.body.length - headLength - tailLength);
  const omission = `\n[OMITTED ${omitted} UTF-16 CODE UNITS]\n`;
  const adjustedBudget = Math.max(2, limit - prefix.length - fixedSuffix.length - omission.length);
  const adjustedHead = Math.ceil(adjustedBudget / 2);
  const adjustedTail = Math.floor(adjustedBudget / 2);
  return `${prefix}${turn.body.slice(0, adjustedHead)}${omission}${turn.body.slice(-adjustedTail)}${fixedSuffix}`;
}

function validateAndSelectFrontier(
  workspaceId: WorkspaceId,
  segments: readonly CompactionSegment[],
  beforeSequence: number,
  policyVersion: string,
): CompactionSegment[] {
  for (const segment of segments) {
    if (segment.workspaceId !== workspaceId) throw new Error("Historical segments cannot cross a workspace boundary.");
  }
  const policySegments = segments.filter((segment) => segment.policyVersion === policyVersion);
  const ordered = [...policySegments].sort((left, right) =>
    left.level - right.level || left.firstSourceSequence - right.firstSourceSequence);
  for (let index = 0; index < ordered.length; index += 1) {
    const left = ordered[index]!;
    for (const right of ordered.slice(index + 1)) {
      const overlaps = left.firstSourceSequence <= right.lastSourceSequence &&
        right.firstSourceSequence <= left.lastSourceSequence;
      if (!overlaps) continue;
      const declaredRelationship = left.childSegmentIds.includes(right.id) || right.childSegmentIds.includes(left.id);
      const contains = (left.firstSourceSequence <= right.firstSourceSequence && left.lastSourceSequence >= right.lastSourceSequence) ||
        (right.firstSourceSequence <= left.firstSourceSequence && right.lastSourceSequence >= left.lastSourceSequence);
      if (!declaredRelationship && (!contains || left.level === right.level)) {
        throw new Error("Historical segment ranges overlap without a parent-child relationship.");
      }
    }
  }

  const eligible = policySegments.filter((segment) => segment.lastSourceSequence < beforeSequence);
  const childIds = new Set(eligible.flatMap((segment) => segment.childSegmentIds));
  const roots = eligible.filter((segment) => !childIds.has(segment.id));
  const selected: CompactionSegment[] = [];
  for (const candidate of [...roots].sort((left, right) =>
    left.firstSourceSequence - right.firstSourceSequence || right.level - left.level)) {
    if (selected.some((entry) => entry.lastSourceSequence >= candidate.firstSourceSequence)) {
      throw new Error("Selected historical frontier contains overlapping ranges.");
    }
    selected.push(candidate);
  }
  return selected;
}

function renderHistorySegment(segment: CompactionSegment): string {
  return [
    `BEGIN DERIVED NON-AUTHORITATIVE HISTORY (level ${segment.level}; sources ${segment.firstSourceSequence}-${segment.lastSourceSequence})`,
    JSON.stringify(segment.summary),
    "END DERIVED NON-AUTHORITATIVE HISTORY",
  ].join("\n");
}

function renderActions(actions: ReturnType<typeof AgentActionContextSchema.parse> | undefined): string | undefined {
  if (actions === undefined) return undefined;
  const items: string[] = [];
  for (const item of [...actions.items].reverse()) {
    const rendered = `[${item.kind} | source ${item.sourceEventId}]\n${JSON.stringify(item.outcome)}`;
    const candidate = `BEGIN UNTRUSTED AGENT ACTION OUTCOMES\n${[rendered, ...items].join("\n\n")}\nEND UNTRUSTED AGENT ACTION OUTCOMES`;
    if (candidate.length > AGENT_ACTION_MAX_UTF16) continue;
    items.unshift(rendered);
  }
  return items.length === 0 ? undefined : `BEGIN UNTRUSTED AGENT ACTION OUTCOMES\n${items.join("\n\n")}\nEND UNTRUSTED AGENT ACTION OUTCOMES`;
}

export type AssembleConversationContextInput = {
  workspaceId: WorkspaceId;
  focalSourceEventId: SourceEventId;
  sourceEvents: readonly SourceEvent[];
  attachments?: readonly ContinuityAttachment[];
  readySegments: readonly CompactionSegment[];
  familyMap?: { workspaceId: WorkspaceId; content: string; revision: number };
  agentActions?: unknown;
  system: string;
  compactionPending: boolean;
  policy?: ContinuityPolicy;
};

export function assembleConversationContext(input: AssembleConversationContextInput) {
  if (input.system.length === 0) throw new Error("System and safety instructions are required.");
  if (input.familyMap !== undefined && input.familyMap.workspaceId !== input.workspaceId) {
    throw new Error("Family-map context cannot cross a workspace boundary.");
  }
  const actions = input.agentActions === undefined ? undefined : AgentActionContextSchema.parse(input.agentActions);
  if (actions !== undefined && actions.workspaceId !== input.workspaceId) {
    throw new Error("Agent actions cannot cross a workspace boundary.");
  }
  const sourceIds = new Set(input.sourceEvents.map((event) => event.id));
  if (actions?.items.some((item) => !sourceIds.has(item.sourceEventId))) {
    throw new Error("Agent action source references must belong to the assembled workspace evidence.");
  }

  const projected = projectEffectiveConversation(input.workspaceId, input.sourceEvents, input.attachments);
  const focal = projected.find((turn) => turn.sourceEventId === input.focalSourceEventId);
  if (focal === undefined) throw new Error("The focal source event is not available in the effective projection.");
  const familyMap = input.familyMap?.content;
  const agentActions = renderActions(actions);
  const policy = input.policy ?? CONTINUITY_POLICIES.production;
  const protectedPrefix = joinBlocks([input.system, familyMap, agentActions]);
  const recentLimit = Math.min(
    input.compactionPending ? policy.recentHardCeilingUtf16 : policy.compactionTriggerUtf16,
    ASSEMBLED_CONTEXT_MAX_UTF16 - protectedPrefix.length - (protectedPrefix.length === 0 ? 0 : 2),
  );
  if (recentLimit <= 0) throw new Error("Protected context blocks leave no room for the focal conversation turn.");
  const renderedFocal = renderProjectedTurn(focal);
  const focalRendering = renderedFocal.length <= recentLimit
    ? renderedFocal
    : renderFocalExcerpt(focal, recentLimit);

  const selectedNewestFirst: Array<{ turn: ProjectedTurn; rendered: string }> = [{ turn: focal, rendered: focalRendering }];
  let used = focalRendering.length;
  for (const turn of projected.filter((candidate) => candidate.sourceSequence < focal.sourceSequence).reverse()) {
    const rendered = renderProjectedTurn(turn);
    const separatorCost = selectedNewestFirst.length === 0 ? 0 : 2;
    if (used + separatorCost + rendered.length > recentLimit) break;
    selectedNewestFirst.push({ turn, rendered });
    used += separatorCost + rendered.length;
  }
  selectedNewestFirst.sort((left, right) => left.turn.sourceSequence - right.turn.sourceSequence);
  let omittedSourceEventCount = projected.length - selectedNewestFirst.length;
  let recentParts = selectedNewestFirst.map((entry) => entry.rendered);
  if (omittedSourceEventCount > 0) {
    while (recentParts.length > 1 && [PENDING_HISTORY_MARKER, ...recentParts].join("\n\n").length > recentLimit) {
      const removed = selectedNewestFirst.shift();
      if (removed?.turn.sourceEventId === focal.sourceEventId) {
        selectedNewestFirst.push(removed);
        selectedNewestFirst.sort((left, right) => left.turn.sourceSequence - right.turn.sourceSequence);
        break;
      }
      omittedSourceEventCount += 1;
      recentParts = selectedNewestFirst.map((entry) => entry.rendered);
    }
    if ([PENDING_HISTORY_MARKER, ...recentParts].join("\n\n").length > recentLimit) {
      const focalEntry = selectedNewestFirst.find((entry) => entry.turn.sourceEventId === focal.sourceEventId);
      if (focalEntry === undefined) throw new Error("The focal turn was lost during context selection.");
      const focalLimit = recentLimit - PENDING_HISTORY_MARKER.length - 2;
      focalEntry.rendered = renderedFocal.length <= focalLimit
        ? renderedFocal
        : renderFocalExcerpt(focal, focalLimit);
      recentParts = selectedNewestFirst.map((entry) => entry.rendered);
    }
    recentParts = [PENDING_HISTORY_MARKER, ...recentParts];
  }
  const recentConversation = recentParts.join("\n\n");
  if (recentConversation.length > recentLimit) throw new Error("Recent conversation exceeded its hard character ceiling.");
  const recentConversationBeforeFocal = [
    ...(omittedSourceEventCount > 0 ? [PENDING_HISTORY_MARKER] : []),
    ...selectedNewestFirst
      .filter((entry) => entry.turn.sourceEventId !== focal.sourceEventId)
      .map((entry) => entry.rendered),
  ].join("\n\n");
  const recentMessagesBeforeFocal = selectedNewestFirst
    .filter((entry) => entry.turn.sourceEventId !== focal.sourceEventId)
    .map((entry) => ({
      role: entry.turn.authorMemberId === "MEDBUDDY" ? "AGENT" as const : "HUMAN" as const,
      authorMemberId: entry.turn.authorMemberId,
      content: entry.turn.body,
    }));

  const firstRecentSequence = Math.min(...selectedNewestFirst.map((entry) => entry.turn.sourceSequence));
  const frontier = validateAndSelectFrontier(
    input.workspaceId,
    input.readySegments,
    firstRecentSequence,
    policy.policyVersion,
  );
  const selectedSegments: CompactionSegment[] = [];
  let history = "";
  const fixedWithoutHistory = [input.system, familyMap, agentActions, recentConversation];
  for (const candidate of [...frontier].reverse()) {
    const candidateSegments = [candidate, ...selectedSegments];
    const candidateHistory = candidateSegments.map(renderHistorySegment).join("\n\n");
    const omitted = candidateSegments.length < frontier.length;
    const markedHistory = omitted ? `${OMITTED_HISTORY_MARKER}\n\n${candidateHistory}` : candidateHistory;
    if (joinBlocks([input.system, familyMap, agentActions, markedHistory, recentConversation]).length > ASSEMBLED_CONTEXT_MAX_UTF16) {
      break;
    }
    selectedSegments.unshift(candidate);
    history = markedHistory;
  }
  if (selectedSegments.length === 0 && frontier.length > 0 &&
      joinBlocks([...fixedWithoutHistory.slice(0, 3), OMITTED_HISTORY_MARKER, recentConversation]).length <= ASSEMBLED_CONTEXT_MAX_UTF16) {
    history = OMITTED_HISTORY_MARKER;
  }
  const context = AssembledContextSchema.parse({
    workspaceId: input.workspaceId,
    focalSourceEventId: input.focalSourceEventId,
    system: input.system,
    familyMap,
    agentActions,
    history,
    recentConversation,
    recentConversationBeforeFocal,
    recentMessagesBeforeFocal,
    omittedSourceEventCount,
  });
  const rendered = joinBlocks([context.system, context.familyMap, context.agentActions, context.history, context.recentConversation]);
  return { ...context, rendered, selectedSegments, projectedTurns: projected };
}
