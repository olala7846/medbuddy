import { describe, expect, it } from "vitest";
import { AtomicFactSchema, HandoffVersionDocumentSchema, WorkspaceDocumentSchema, type TransactionalPersistence, type WorkspaceRepository } from "../src/index.js";

export function describeTransactionalPersistenceContract(create: () => { persistence: TransactionalPersistence; workspaces: WorkspaceRepository }): void {
  describe("transactional persistence contract", () => {
    const workspace = WorkspaceDocumentSchema.parse({ id: "workspace:transaction", ownerMemberId: "member:owner", approvalState: "APPROVED", createdAt: "2026-07-28T10:00:00.000Z", updatedAt: "2026-07-28T10:00:00.000Z" });
    it("rolls back staged writes when the operation fails", async () => {
      const { persistence, workspaces } = create();
      await expect(persistence.runTransaction(async (repositories) => { await repositories.workspaces.putWorkspace(workspace); throw new Error("rollback"); })).rejects.toThrow("rollback");
      await expect(workspaces.getWorkspace(workspace.id)).resolves.toBeNull();
    });
    it("runs duplicate idempotent delivery once", async () => {
      const { persistence, workspaces } = create();
      let runs = 0;
      await persistence.runIdempotent("transaction-contract", async (repositories) => { runs += 1; await repositories.workspaces.putWorkspace(workspace); return "done"; });
      await persistence.runIdempotent("transaction-contract", async () => { runs += 1; return "again"; });
      expect(runs).toBe(1);
      await expect(workspaces.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    });
    it("replays a completed void operation", async () => {
      const { persistence } = create();
      let runs = 0;
      await persistence.runIdempotent("transaction-contract-void", async () => { runs += 1; });
      await persistence.runIdempotent("transaction-contract-void", async () => { runs += 1; });
      expect(runs).toBe(1);
    });
    it("publishes a handoff and current pointer together, without orphaning a missing workspace", async () => {
      const { persistence, workspaces } = create();
      const fact = AtomicFactSchema.parse({ id: "fact:transaction", workspaceId: workspace.id, sourceMessageId: "message:transaction", contributorMemberId: workspace.ownerMemberId, kind: "INSTRUCTION", value: { instruction: "Use the fictional tablet after breakfast." }, provenance: "OWNER_REPORT", reviewStatus: "UNREVIEWED", enteredAt: workspace.createdAt, conflictsWithFactIds: [] });
      const handoff = HandoffVersionDocumentSchema.parse({ id: "handoff:transaction", workspaceId: workspace.id, version: 1, createdByMemberId: workspace.ownerMemberId, createdAt: workspace.createdAt, sourceMessageIds: [fact.sourceMessageId], sourceFactIds: [fact.id], sourceReviewEventIds: [], snapshot: { version: 1, facts: [fact], conflicts: [], medicationSources: [], unresolvedItems: ["Confirm timing with a pharmacist or clinic."], limitations: ["This fictional handoff is not medical advice."] } });
      await persistence.runTransaction(async (repositories) => { await repositories.workspaces.putWorkspace(workspace); await repositories.careRecords.createHandoff(handoff); });
      await expect(workspaces.getWorkspace(workspace.id)).resolves.toMatchObject({ currentHandoffVersionId: handoff.id });
      const orphanFact = AtomicFactSchema.parse({ ...fact, workspaceId: "workspace:missing" });
      const orphan = HandoffVersionDocumentSchema.parse({ ...handoff, id: "handoff:orphan", workspaceId: "workspace:missing", snapshot: { ...handoff.snapshot, facts: [orphanFact] } });
      await expect(persistence.runTransaction(async (repositories) => repositories.careRecords.createHandoff(orphan))).rejects.toThrow("missing workspace");
      await expect(persistence.runTransaction(async (repositories) => repositories.careRecords.getHandoff(orphan.workspaceId, orphan.id))).resolves.toBeNull();
    });
  });
}
