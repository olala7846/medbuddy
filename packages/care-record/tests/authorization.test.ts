import { describe, expect, it } from "vitest";

import {
  AtomicFactSchema,
  MemberDocumentSchema,
  WorkspaceDocumentSchema,
} from "@medbuddy/contracts";

import {
  createMembershipSnapshotHash,
  determineWorkspaceEligibility,
  requireContributorClaimAuthority,
  requireOwnerWorkspaceAuthority,
} from "../src/index.js";

const approvedMembershipHash =
  '[{"id":"member:caregiver-a","workspaceId":"workspace:demo","role":"CAREGIVER","processingConsent":true,"joinedAt":"2026-07-28T10:00:00.000Z"},{"id":"member:owner","workspaceId":"workspace:demo","role":"OWNER","processingConsent":true,"joinedAt":"2026-07-28T10:00:00.000Z"}]';

const workspace = WorkspaceDocumentSchema.parse({
  id: "workspace:demo",
  ownerMemberId: "member:owner",
  approvalState: "APPROVED" as const,
  approvedMembershipHash,
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
});

const approvedMembers = [
  MemberDocumentSchema.parse({
    id: "member:owner",
    workspaceId: workspace.id,
    role: "OWNER" as const,
    processingConsent: true,
    joinedAt: workspace.createdAt,
  }),
  MemberDocumentSchema.parse({
    id: "member:caregiver-a",
    workspaceId: workspace.id,
    role: "CAREGIVER" as const,
    processingConsent: true,
    joinedAt: workspace.createdAt,
  }),
];

describe("approved-workspace authority", () => {
  it("returns eligible only for an approved workspace with an approved membership snapshot and consented owner and members", () => {
    expect(createMembershipSnapshotHash(approvedMembers)).toBe(approvedMembershipHash);
    expect(determineWorkspaceEligibility(workspace, approvedMembers)).toEqual({
      eligible: true,
    });
    expect(
      determineWorkspaceEligibility({ ...workspace, approvalState: "BLOCKED" }, approvedMembers),
    ).toEqual({ eligible: false, reason: "WORKSPACE_NOT_APPROVED" });
    expect(
      determineWorkspaceEligibility({ ...workspace, approvedMembershipHash: undefined }, approvedMembers),
    ).toEqual({ eligible: false, reason: "MEMBERSHIP_NOT_APPROVED" });
    const nonConsentingMembers = [
      approvedMembers[0]!,
      { ...approvedMembers[1]!, processingConsent: false },
    ];
    expect(
      determineWorkspaceEligibility(
        {
          ...workspace,
          approvedMembershipHash: createMembershipSnapshotHash(nonConsentingMembers),
        },
        nonConsentingMembers,
      ),
    ).toEqual({ eligible: false, reason: "MEMBER_CONSENT_REQUIRED" });
    expect(
      determineWorkspaceEligibility(workspace, [approvedMembers[0]!]),
    ).toEqual({ eligible: false, reason: "MEMBERSHIP_NOT_APPROVED" });
    expect(
      determineWorkspaceEligibility(workspace, [
        approvedMembers[0]!,
        approvedMembers[1]!,
        MemberDocumentSchema.parse({
          id: "member:caregiver-b",
          workspaceId: workspace.id,
          role: "CAREGIVER",
          processingConsent: true,
          joinedAt: workspace.createdAt,
        }),
      ]),
    ).toEqual({ eligible: false, reason: "MEMBERSHIP_NOT_APPROVED" });
    expect(
      determineWorkspaceEligibility(workspace, [
        approvedMembers[0]!,
        { ...approvedMembers[1]!, joinedAt: "2026-07-29T10:00:00.000Z" },
      ]),
    ).toEqual({ eligible: false, reason: "MEMBERSHIP_NOT_APPROVED" });
  });

  it("rejects foreign members and invalid owner configurations before treating a workspace as eligible", () => {
    expect(
      determineWorkspaceEligibility(workspace, [
        approvedMembers[0]!,
        MemberDocumentSchema.parse({ ...approvedMembers[1]!, workspaceId: "workspace:other" }),
      ]),
    ).toEqual({ eligible: false, reason: "MEMBER_WORKSPACE_INVALID" });
    const membersWithoutAnOwner = approvedMembers.map((member) => ({
      ...member,
      role: "CAREGIVER" as const,
    }));
    expect(
      determineWorkspaceEligibility(
        {
          ...workspace,
          approvedMembershipHash: createMembershipSnapshotHash(membersWithoutAnOwner),
        },
        membersWithoutAnOwner,
      ),
    ).toEqual({ eligible: false, reason: "OWNER_MEMBERSHIP_INVALID" });
    expect(
      determineWorkspaceEligibility({ ...workspace, approvalState: "REVOKED" }, approvedMembers),
    ).toEqual({ eligible: false, reason: "WORKSPACE_NOT_APPROVED" });
  });

  it("allows health-workspace sharing, revocation, and reset only for the immutable owner", () => {
    for (const action of ["SHARE", "REVOKE", "RESET"] as const) {
      expect(() =>
        requireOwnerWorkspaceAuthority(workspace, approvedMembers[0]!.id, action),
      ).not.toThrow();
      expect(() =>
        requireOwnerWorkspaceAuthority(workspace, approvedMembers[1]!.id, action),
      ).toThrow("Only the workspace owner may");
    }
  });

  it("allows contributors to modify only their server-loaded claim", () => {
    const contributorFact = AtomicFactSchema.parse({
      id: "fact:owner-report",
      workspaceId: workspace.id,
      sourceMessageId: "message:owner-report",
      contributorMemberId: "member:owner",
      kind: "SYMPTOM" as const,
      value: { symptom: "fictional mild dizziness" },
      provenance: "OWNER_REPORT" as const,
      reviewStatus: "UNREVIEWED" as const,
      enteredAt: workspace.createdAt,
      conflictsWithFactIds: [],
    });

    expect(() =>
      requireContributorClaimAuthority(workspace, approvedMembers[0]!.id, contributorFact),
    ).not.toThrow();
    expect(() =>
      requireContributorClaimAuthority(workspace, approvedMembers[1]!.id, contributorFact),
    ).toThrow("Only the original contributor may modify their claim.");
    expect(() =>
      requireContributorClaimAuthority(
        workspace,
        approvedMembers[0]!.id,
        AtomicFactSchema.parse({ ...contributorFact, workspaceId: "workspace:other" }),
      ),
    ).toThrow("The claim does not belong to the workspace.");
  });
});
