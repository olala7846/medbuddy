import type {
  AtomicFact,
  MemberDocument,
  MemberId,
  WorkspaceDocument,
} from "@medbuddy/contracts";

export type WorkspaceEligibility =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | "WORKSPACE_NOT_APPROVED"
        | "MEMBERSHIP_NOT_APPROVED"
        | "OWNER_MEMBERSHIP_INVALID"
        | "MEMBER_CONSENT_REQUIRED";
    };

export type WorkspaceControlAction = "SHARE" | "REVOKE" | "RESET";

/**
 * Returns the eligibility required before any health processing or output.
 * The caller supplies the current membership snapshot hash from its repository
 * transaction; this domain service never derives authority from a model or client.
 */
export function determineWorkspaceEligibility(
  workspace: WorkspaceDocument,
  members: readonly MemberDocument[],
  currentMembershipHash: string,
): WorkspaceEligibility {
  if (workspace.approvalState !== "APPROVED") {
    return { eligible: false, reason: "WORKSPACE_NOT_APPROVED" };
  }

  if (
    workspace.approvedMembershipHash === undefined ||
    workspace.approvedMembershipHash !== currentMembershipHash
  ) {
    return { eligible: false, reason: "MEMBERSHIP_NOT_APPROVED" };
  }

  const owners = members.filter((member) => member.role === "OWNER");
  if (owners.length !== 1 || owners[0]?.id !== workspace.ownerMemberId) {
    return { eligible: false, reason: "OWNER_MEMBERSHIP_INVALID" };
  }

  if (members.some((member) => !member.processingConsent)) {
    return { eligible: false, reason: "MEMBER_CONSENT_REQUIRED" };
  }

  return { eligible: true };
}

export function requireOwnerWorkspaceAuthority(
  workspace: WorkspaceDocument,
  actorMemberId: MemberId,
  action: WorkspaceControlAction,
): void {
  if (actorMemberId !== workspace.ownerMemberId) {
    throw new Error(`Only the workspace owner may ${action.toLowerCase()} this health workspace.`);
  }
}

export function requireContributorClaimAuthority(
  workspace: WorkspaceDocument,
  actorMemberId: MemberId,
  serverLoadedFact: AtomicFact,
): void {
  if (serverLoadedFact.workspaceId !== workspace.id) {
    throw new Error("The claim does not belong to the workspace.");
  }

  if (serverLoadedFact.contributorMemberId !== actorMemberId) {
    throw new Error("Only the original contributor may modify their claim.");
  }
}
