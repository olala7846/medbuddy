import { createHash } from "node:crypto";
import { createMembershipSnapshotHash } from "@medbuddy/care-record";
import {
  HandoffVersionDocumentSchema,
  AtomicFactSchema,
  MemberDocumentSchema,
  MessageDocumentSchema,
  WorkspaceDocumentSchema,
  type AccountId,
  type DemoWorkspaceMapping,
  type DemoWorkspaceProvisioner,
  type DemoWorkspaceResetInput,
  type MemberDocument,
  type PersistenceRepositories,
  type WorkspaceId,
  GoldenScenario,
} from "@medbuddy/contracts";
import type { DemoWorkspacePersistence } from "@medbuddy/platform";

export const FICTIONAL_DEMO_TEMPLATE_VERSION = "golden-2026-07-28-v1";
export const CREDENTIAL_TEST_WORKSPACE_ID = "workspace:credential-test" as WorkspaceId;

const TEMPLATE_PARTICIPANTS = [
  { id: "member:owner", role: "OWNER" as const },
  { id: "member:caregiver-a", role: "CAREGIVER" as const },
  { id: "member:caregiver-b", role: "CAREGIVER" as const },
];
const TEMPLATE_CREATED_AT = "2026-07-28T10:00:00.000Z";

function workspaceIdFor(accountId: AccountId, resetKey?: string): WorkspaceId {
  const seed = resetKey === undefined ? accountId : `${accountId}:${resetKey}`;
  return `workspace:reviewer-${createHash("sha256").update(seed).digest("hex").slice(0, 24)}` as WorkspaceId;
}

function membersFor(workspaceId: WorkspaceId): MemberDocument[] {
  return TEMPLATE_PARTICIPANTS.map((participant) => MemberDocumentSchema.parse({
    ...participant,
    workspaceId,
    processingConsent: true,
    joinedAt: TEMPLATE_CREATED_AT,
  }));
}

function cloneFactForWorkspace<Fact extends (typeof GoldenScenario.facts)[number]>(
  fact: Fact,
  workspaceId: WorkspaceId,
) {
  return AtomicFactSchema.parse({ ...structuredClone(fact), workspaceId });
}

function templateMessages(workspaceId: WorkspaceId) {
  const byId = new Map<string, ReturnType<typeof MessageDocumentSchema.parse>>();
  for (const fact of GoldenScenario.facts) {
    if (!byId.has(fact.sourceMessageId)) {
      byId.set(fact.sourceMessageId, MessageDocumentSchema.parse({
        id: fact.sourceMessageId,
        workspaceId,
        authorMemberId: fact.contributorMemberId,
        body: "Fictional scenario source message retained for provenance review.",
        createdAt: fact.enteredAt,
        attachmentIds: [],
        captureIntent: "PASSIVE",
        processingStatus: "CAPTURED",
        processingAttempts: 1,
      }));
    }
  }
  return [...byId.values()];
}

function handoffForWorkspace(
  handoff: typeof GoldenScenario.handoffV1 | typeof GoldenScenario.handoffV2,
  workspaceId: WorkspaceId,
) {
  return HandoffVersionDocumentSchema.parse({
    ...structuredClone(handoff),
    workspaceId,
    snapshot: {
      ...structuredClone(handoff.snapshot),
      facts: handoff.snapshot.facts.map((fact) => ({ ...structuredClone(fact), workspaceId })),
      conflicts: handoff.snapshot.conflicts.map((conflict) => ({ ...structuredClone(conflict), workspaceId })),
    },
  });
}

async function seedFictionalWorkspace(
  repositories: PersistenceRepositories,
  workspaceId: WorkspaceId,
): Promise<void> {
  const existing = await repositories.workspaces.getWorkspace(workspaceId);
  if (existing) return;

  const members = membersFor(workspaceId);
  const workspace = WorkspaceDocumentSchema.parse({
    id: workspaceId,
    ownerMemberId: "member:owner",
    approvalState: "APPROVED",
    approvedMembershipHash: createMembershipSnapshotHash(members),
    createdAt: TEMPLATE_CREATED_AT,
    updatedAt: TEMPLATE_CREATED_AT,
  });
  await repositories.workspaces.putWorkspace(workspace);
  for (const member of members) await repositories.members.putMember(member);
  for (const message of templateMessages(workspaceId)) await repositories.messages.putMessage(message);
  for (const fact of GoldenScenario.facts) {
    await repositories.careRecords.putFact(cloneFactForWorkspace(fact, workspaceId));
  }
  await repositories.careRecords.createHandoff(handoffForWorkspace(GoldenScenario.handoffV1, workspaceId));
  await repositories.careRecords.createHandoff(handoffForWorkspace(GoldenScenario.handoffV2, workspaceId));
}

/**
 * Provisions only committed fictional records. Reviewers are mapped to a copy
 * of the template, never to a health participant or credential test workspace.
 */
export class FictionalDemoWorkspaceProvisioner implements DemoWorkspaceProvisioner {
  constructor(private readonly persistence: DemoWorkspacePersistence) {}

  async getOrCreate(accountId: AccountId): Promise<DemoWorkspaceMapping> {
    return this.persistence.runDemoWorkspaceTransaction(async ({ mappings, repositories }) => {
      const current = await mappings.get(accountId);
      if (current) return current;
      const workspaceId = workspaceIdFor(accountId);
      await seedFictionalWorkspace(repositories, workspaceId);
      const mapping: DemoWorkspaceMapping = { accountId, workspaceId, templateVersion: FICTIONAL_DEMO_TEMPLATE_VERSION, createdAt: TEMPLATE_CREATED_AT };
      await mappings.put(mapping);
      return mapping;
    });
  }

  async reset(input: DemoWorkspaceResetInput): Promise<DemoWorkspaceMapping> {
    return this.persistence.runDemoWorkspaceTransaction(async ({ mappings, repositories }) => {
      const current = await mappings.get(input.accountId);
      const workspaceId = workspaceIdFor(input.accountId, input.idempotencyKey);
      if (current?.workspaceId === workspaceId) return current;
      await seedFictionalWorkspace(repositories, workspaceId);
      const mapping: DemoWorkspaceMapping = {
        accountId: input.accountId,
        workspaceId,
        templateVersion: FICTIONAL_DEMO_TEMPLATE_VERSION,
        createdAt: TEMPLATE_CREATED_AT,
        ...(current ? { replacedWorkspaceId: current.workspaceId } : {}),
      };
      await mappings.put(mapping);
      return mapping;
    });
  }
}

/** Seeds the fixed credential-only workspace without creating reviewer mappings. */
export async function seedCredentialTestWorkspace(persistence: DemoWorkspacePersistence): Promise<void> {
  await persistence.runDemoWorkspaceTransaction(async ({ repositories }) =>
    seedFictionalWorkspace(repositories, CREDENTIAL_TEST_WORKSPACE_ID),
  );
}
