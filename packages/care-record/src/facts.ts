import {
  AtomicFactSchema,
  ConflictSchema,
  CorrectionSchema,
  type AtomicFact,
  type Conflict,
  type Correction,
  type WorkspaceDocument,
} from "@medbuddy/contracts";

import { requireContributorClaimAuthority } from "./authorization.js";

export function createCandidateFact(fact: AtomicFact): AtomicFact {
  return AtomicFactSchema.parse(fact);
}

/**
 * Appends a corrected claim after checking the original server-loaded fact.
 * The original fact is returned untouched so callers can persist both facts.
 */
export function appendCorrection({
  workspace,
  actorMemberId,
  originalFact,
  correctionFact,
}: Correction & { workspace: WorkspaceDocument }): AtomicFact {
  requireContributorClaimAuthority(workspace, actorMemberId, originalFact);
  return CorrectionSchema.parse({ actorMemberId, originalFact, correctionFact }).correctionFact;
}

/**
 * Links two separately stored claims without reconciling or rewriting either.
 */
export function createConflict(
  conflict: Conflict,
  firstFact: AtomicFact,
  secondFact: AtomicFact,
): Conflict {
  if (
    firstFact.workspaceId !== conflict.workspaceId ||
    secondFact.workspaceId !== conflict.workspaceId
  ) {
    throw new Error("Conflicting claims must belong to the same workspace.");
  }

  const parsedConflict = ConflictSchema.parse(conflict);
  const factIds = new Set(parsedConflict.factIds);
  if (
    factIds.size !== 2 ||
    !factIds.has(firstFact.id) ||
    !factIds.has(secondFact.id)
  ) {
    throw new Error("A conflict must link the supplied separately attributed claims.");
  }

  return parsedConflict;
}
