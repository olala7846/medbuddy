import { describe, expect, it } from "vitest";
import { WorkspaceDocumentSchema, type TransactionalPersistence, type WorkspaceRepository } from "../src/index.js";

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
  });
}
