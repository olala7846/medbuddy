import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it } from "vitest";
import {
  AtomicFactSchema,
  HandoffVersionDocumentSchema,
  WorkspaceDocumentSchema,
} from "@medbuddy/contracts";
import {
  describeAttachmentRepositoryContract,
  describeCareRecordRepositoryContract,
  describeMemberRepositoryContract,
  describeMessageRepositoryContract,
  describeWorkspaceRepositoryContract,
} from "@medbuddy/contracts/adapter-contract-tests";

import { FirestorePersistence } from "../src/index.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeEmulator = emulatorHost ? describe : describe.skip;

function persistence() {
  return new FirestorePersistence(new Firestore({ projectId: "medbuddy-platform-test" }));
}

describeEmulator("Firestore emulator persistence", () => {
  describeWorkspaceRepositoryContract(() => persistence().workspaces);
  describeMemberRepositoryContract(() => persistence().members);
  describeMessageRepositoryContract(() => persistence().messages);
  describeAttachmentRepositoryContract(() => persistence().attachments);
  describeCareRecordRepositoryContract(() => persistence().careRecords);

  it("publishes a handoff and its current pointer atomically and idempotently", async () => {
    const platform = persistence();
    const workspace = WorkspaceDocumentSchema.parse({
      id: "workspace:handoff",
      ownerMemberId: "member:owner",
      approvalState: "APPROVED",
      createdAt: "2026-07-28T10:00:00.000Z",
      updatedAt: "2026-07-28T10:00:00.000Z",
    });
    const fact = AtomicFactSchema.parse({
      id: "fact:handoff",
      workspaceId: workspace.id,
      sourceMessageId: "message:handoff",
      contributorMemberId: workspace.ownerMemberId,
      kind: "INSTRUCTION",
      value: { instruction: "Use the fictional tablet after breakfast." },
      provenance: "OWNER_REPORT",
      reviewStatus: "UNREVIEWED",
      enteredAt: workspace.createdAt,
      conflictsWithFactIds: [],
    });
    const handoff = HandoffVersionDocumentSchema.parse({
      id: "handoff:v1",
      workspaceId: workspace.id,
      version: 1,
      createdByMemberId: workspace.ownerMemberId,
      createdAt: workspace.createdAt,
      sourceMessageIds: [fact.sourceMessageId],
      sourceFactIds: [fact.id],
      sourceReviewEventIds: [],
      snapshot: {
        version: 1,
        facts: [fact],
        conflicts: [],
        medicationSources: [],
        unresolvedItems: ["Confirm timing with a pharmacist or clinic."],
        limitations: ["This fictional handoff is not medical advice."],
      },
    });

    await platform.workspaces.putWorkspace(workspace);
    await platform.careRecords.createHandoff(handoff);
    await platform.careRecords.createHandoff(handoff);

    await expect(platform.careRecords.getHandoff(workspace.id, handoff.id)).resolves.toEqual(handoff);
    await expect(platform.workspaces.getWorkspace(workspace.id)).resolves.toMatchObject({
      currentHandoffVersionId: handoff.id,
    });
  });
});
