import {
  AtomicFactSchema,
  ReviewEventSchema,
  type AtomicFact,
  type MemberDocument,
  type ReviewEvent,
  type ReviewInput,
  type WorkspaceDocument,
} from "@medbuddy/contracts";

import {
  requireContributorClaimAuthority,
  requireWorkspaceMemberAuthority,
} from "./authorization.js";

export interface FactReviewResult {
  fact: AtomicFact;
  reviewEvent: ReviewEvent;
}

export interface ApplyFactReviewInput {
  workspace: WorkspaceDocument;
  actor: MemberDocument;
  fact: AtomicFact;
  input: ReviewInput;
  reviewEventId: string;
  createdAt: string;
}

const statusForAction = {
  ACCEPT: "ACCEPTED",
  REJECT: "REJECTED",
  MARK_UNCERTAIN: "UNCERTAIN",
  WITHDRAW: "WITHDRAWN",
} as const;

/**
 * Applies a review to a server-loaded fact. The returned fact is a new value;
 * callers keep the original fact and append the immutable review event.
 */
export function applyFactReview({
  workspace,
  actor,
  fact,
  input,
  reviewEventId,
  createdAt,
}: ApplyFactReviewInput): FactReviewResult {
  requireWorkspaceMemberAuthority(workspace, actor);
  if (fact.workspaceId !== workspace.id) {
    throw new Error("The claim does not belong to the workspace.");
  }
  if (input.workspaceId !== workspace.id) {
    throw new Error("Review input must belong to the workspace.");
  }
  if (input.factId !== fact.id) {
    throw new Error("Review input must identify the server-loaded fact.");
  }
  if (input.action === "WITHDRAW") {
    requireContributorClaimAuthority(workspace, actor.id, fact);
  }

  const reviewEvent = ReviewEventSchema.parse({
    id: reviewEventId,
    workspaceId: workspace.id,
    factId: fact.id,
    actorMemberId: actor.id,
    action: input.action,
    createdAt,
    note: input.note,
  });
  const updatedFact = AtomicFactSchema.parse({
    ...fact,
    reviewStatus: statusForAction[input.action],
  });

  return { fact: updatedFact, reviewEvent };
}
