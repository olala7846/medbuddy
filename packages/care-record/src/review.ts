import {
  AtomicFactSchema,
  ReviewEventSchema,
  type AtomicFact,
  type MemberId,
  type ReviewEvent,
  type ReviewInput,
  type WorkspaceDocument,
} from "@medbuddy/contracts";

import { requireContributorClaimAuthority } from "./authorization.js";

export interface FactReviewResult {
  fact: AtomicFact;
  reviewEvent: ReviewEvent;
}

export interface ApplyFactReviewInput {
  workspace: WorkspaceDocument;
  actorMemberId: MemberId;
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
  actorMemberId,
  fact,
  input,
  reviewEventId,
  createdAt,
}: ApplyFactReviewInput): FactReviewResult {
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
    requireContributorClaimAuthority(workspace, actorMemberId, fact);
  }

  const reviewEvent = ReviewEventSchema.parse({
    id: reviewEventId,
    workspaceId: workspace.id,
    factId: fact.id,
    actorMemberId,
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
