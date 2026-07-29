import {
  HandoffVersionSchema,
  type AtomicFact,
  type Conflict,
  type HandoffSnapshot,
  type HandoffVersion,
  type MedicationSourceCard,
  type MemberDocument,
  type ReviewEvent,
  type WorkspaceDocument,
} from "@medbuddy/contracts";

import { requireWorkspaceMemberAuthority } from "./authorization.js";

export interface AssembleHandoffVersionInput {
  workspace: WorkspaceDocument;
  actor: MemberDocument;
  id: string;
  createdAt: string;
  facts: readonly AtomicFact[];
  conflicts: readonly Conflict[];
  medicationSources: readonly MedicationSourceCard[];
  reviewEvents: readonly ReviewEvent[];
  predecessor?: HandoffVersion;
  unresolvedItems?: readonly string[];
  limitations?: readonly string[];
}

/**
 * Builds a version from server-loaded records. It never mutates those records
 * or a predecessor, so persistence can append this result atomically.
 */
export function assembleHandoffVersion({
  workspace,
  actor,
  id,
  createdAt,
  facts,
  conflicts,
  medicationSources,
  reviewEvents,
  predecessor,
  unresolvedItems,
  limitations,
}: AssembleHandoffVersionInput): HandoffVersion {
  requireWorkspaceMemberAuthority(workspace, actor);
  assertWorkspaceRecords(workspace, facts, conflicts, reviewEvents);

  const parsedPredecessor = predecessor === undefined ? undefined : HandoffVersionSchema.parse(predecessor);
  if (parsedPredecessor !== undefined && parsedPredecessor.workspaceId !== workspace.id) {
    throw new Error("A predecessor handoff must belong to the workspace.");
  }

  const version = parsedPredecessor === undefined ? 1 : parsedPredecessor.version + 1;
  const snapshot = structuredClone({
    version,
    facts: [...facts],
    conflicts: [...conflicts],
    medicationSources: [...medicationSources],
    unresolvedItems: unresolvedItems === undefined ? deriveUnresolvedItems(facts) : [...unresolvedItems],
    limitations: limitations === undefined ? deriveLimitations(medicationSources) : [...limitations],
  } satisfies HandoffSnapshot);

  const handoff = HandoffVersionSchema.parse({
    id,
    workspaceId: workspace.id,
    version,
    predecessorVersionId: parsedPredecessor?.id,
    createdByMemberId: actor.id,
    createdAt,
    sourceMessageIds: [...new Set(snapshot.facts.map((fact) => fact.sourceMessageId))],
    sourceFactIds: snapshot.facts.map((fact) => fact.id),
    sourceReviewEventIds: reviewEvents.map((event) => event.id),
    snapshot,
  });

  return deepFreeze(handoff);
}

/** Returns a copy of the selected version's stored snapshot for screen or print rendering. */
export function renderHandoffSnapshot(version: HandoffVersion): HandoffSnapshot {
  return structuredClone(HandoffVersionSchema.parse(version).snapshot);
}

function assertWorkspaceRecords(
  workspace: WorkspaceDocument,
  facts: readonly AtomicFact[],
  conflicts: readonly Conflict[],
  reviewEvents: readonly ReviewEvent[],
): void {
  const factIds = new Set(facts.map((fact) => fact.id));
  if (facts.some((fact) => fact.workspaceId !== workspace.id)) {
    throw new Error("Every handoff fact must belong to the workspace.");
  }
  if (
    conflicts.some(
      (conflict) =>
        conflict.workspaceId !== workspace.id || conflict.factIds.some((factId) => !factIds.has(factId)),
    )
  ) {
    throw new Error("Every handoff conflict must belong to the workspace and reference selected facts.");
  }
  if (
    reviewEvents.some(
      (event) => event.workspaceId !== workspace.id || !factIds.has(event.factId),
    )
  ) {
    throw new Error("Every handoff review event must belong to the workspace and reference a selected fact.");
  }
}

function deriveUnresolvedItems(facts: readonly AtomicFact[]): string[] {
  return facts.flatMap((fact) => {
    if (fact.kind !== "FOLLOW_UP" || fact.value.status !== "UNRESOLVED") {
      return [];
    }
    return ["A reported follow-up question remains unresolved."];
  });
}

function deriveLimitations(sources: readonly MedicationSourceCard[]): string[] {
  const sourceLimitations = sources.flatMap((source) => source.limitations);
  return sourceLimitations.length > 0
    ? [...new Set(sourceLimitations)]
    : ["This handoff preserves reported information and is not medical advice."];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }
  return value;
}
