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
        | "MEMBER_WORKSPACE_INVALID"
        | "OWNER_MEMBERSHIP_INVALID"
        | "MEMBER_CONSENT_REQUIRED";
    };

export type WorkspaceControlAction = "SHARE" | "REVOKE" | "RESET";

export function createMembershipSnapshotHash(members: readonly MemberDocument[]): string {
  return JSON.stringify(
    [...members]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((member) => ({
        id: member.id,
        workspaceId: member.workspaceId,
        role: member.role,
        processingConsent: member.processingConsent,
        joinedAt: member.joinedAt,
      })),
  );
}

/**
 * Returns the eligibility required before any health processing or output.
 * The membership snapshot is derived from server-loaded member records, never a
 * model or client claim.
 */
export function determineWorkspaceEligibility(
  workspace: WorkspaceDocument,
  members: readonly MemberDocument[],
): WorkspaceEligibility {
  if (workspace.approvalState !== "APPROVED") {
    return { eligible: false, reason: "WORKSPACE_NOT_APPROVED" };
  }

  if (members.some((member) => member.workspaceId !== workspace.id)) {
    return { eligible: false, reason: "MEMBER_WORKSPACE_INVALID" };
  }

  if (
    workspace.approvedMembershipHash === undefined ||
    workspace.approvedMembershipHash !== createMembershipSnapshotHash(members)
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
