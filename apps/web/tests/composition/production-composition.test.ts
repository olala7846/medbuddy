import { describe, expect, it } from "vitest";
import { determineWorkspaceEligibility } from "@medbuddy/care-record";
import { InMemoryDemoWorkspacePersistence } from "@medbuddy/platform";
import { AccountIdSchema, HandoffVersionIdSchema } from "@medbuddy/contracts";

import {
  CREDENTIAL_TEST_WORKSPACE_ID,
  FictionalDemoWorkspaceProvisioner,
  seedCredentialTestWorkspace,
} from "../../src/composition/demo-workspace.js";
import {
  ProductionConfigurationError,
  loadProductionConfig,
} from "../../src/composition/config.js";

const productionEnvironment = {
  MEDBUDDY_GCP_PROJECT_ID: "fictional-project",
  MEDBUDDY_TASKS_LOCATION: "us-central1",
  MEDBUDDY_TASKS_QUEUE: "capture",
  MEDBUDDY_CAPTURE_CALLBACK_URL: "https://fictional.example.test/api/internal/capture",
  MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL: "tasks@fictional-project.iam.gserviceaccount.com",
  MEDBUDDY_ATTACHMENT_BUCKET: "fictional-medbuddy-private",
};

describe("production composition configuration", () => {
  it("rejects missing configuration without echoing supplied values", () => {
    const environment = { ...productionEnvironment, MEDBUDDY_TASKS_QUEUE: "", UNRELATED_SECRET: "do-not-echo" };
    expect(() => loadProductionConfig(environment)).toThrow(ProductionConfigurationError);
    expect(() => loadProductionConfig(environment)).toThrow("MEDBUDDY_TASKS_QUEUE");
    expect(() => loadProductionConfig(environment)).not.toThrow("do-not-echo");
  });

  it("returns only the approved platform configuration fields", () => {
    expect(loadProductionConfig(productionEnvironment)).toEqual({
      projectId: "fictional-project",
      tasksLocation: "us-central1",
      tasksQueue: "capture",
      captureCallbackUrl: "https://fictional.example.test/api/internal/capture",
      taskServiceAccountEmail: "tasks@fictional-project.iam.gserviceaccount.com",
      attachmentBucket: "fictional-medbuddy-private",
    });
  });
});

describe("fictional reviewer workspaces", () => {
  it("seeds one approved three-person fictional workspace idempotently", async () => {
    const storage = new InMemoryDemoWorkspacePersistence();
    const provisioner = new FictionalDemoWorkspaceProvisioner(storage);
    const accountId = AccountIdSchema.parse("account:reviewer-a");
    const first = await provisioner.getOrCreate(accountId);
    const repeated = await provisioner.getOrCreate(accountId);

    expect(repeated).toEqual(first);
    const workspace = await storage.persistence.workspaces.getWorkspace(first.workspaceId);
    const members = await storage.persistence.members.listMembers(first.workspaceId);
    expect(workspace?.approvalState).toBe("APPROVED");
    expect(members.map((member) => member.id)).toEqual(["member:owner", "member:caregiver-a", "member:caregiver-b"]);
    expect(workspace && determineWorkspaceEligibility(workspace, members)).toEqual({ eligible: true });
  });

  it("reset creates a replacement and leaves historic handoffs in the original workspace", async () => {
    const storage = new InMemoryDemoWorkspacePersistence();
    const provisioner = new FictionalDemoWorkspaceProvisioner(storage);
    const accountId = AccountIdSchema.parse("account:reviewer-b");
    const original = await provisioner.getOrCreate(accountId);
    const replacement = await provisioner.reset({ accountId, idempotencyKey: "reset-1" });
    const replay = await provisioner.reset({ accountId, idempotencyKey: "reset-1" });

    expect(replacement.workspaceId).not.toBe(original.workspaceId);
    expect(replacement.replacedWorkspaceId).toBe(original.workspaceId);
    expect(replay).toEqual(replacement);
    await expect(storage.persistence.careRecords.getHandoff(original.workspaceId, HandoffVersionIdSchema.parse("handoff:v1"))).resolves.toMatchObject({ version: 1 });
    await expect(storage.persistence.careRecords.getHandoff(replacement.workspaceId, HandoffVersionIdSchema.parse("handoff:v2"))).resolves.toMatchObject({ version: 2 });
  });

  it("replays an earlier reset result without moving the current mapping back", async () => {
    const storage = new InMemoryDemoWorkspacePersistence();
    const provisioner = new FictionalDemoWorkspaceProvisioner(storage);
    const accountId = AccountIdSchema.parse("account:reviewer-reset-replay");
    await provisioner.getOrCreate(accountId);
    const firstReset = await provisioner.reset({ accountId, idempotencyKey: "reset-a" });
    const secondReset = await provisioner.reset({ accountId, idempotencyKey: "reset-b" });
    const replay = await provisioner.reset({ accountId, idempotencyKey: "reset-a" });

    expect(replay).toEqual(firstReset);
    expect((await provisioner.getOrCreate(accountId)).workspaceId).toBe(secondReset.workspaceId);
  });

  it("keeps credential test data outside reviewer mappings", async () => {
    const storage = new InMemoryDemoWorkspacePersistence();
    await seedCredentialTestWorkspace(storage);
    const reviewer = await new FictionalDemoWorkspaceProvisioner(storage).getOrCreate(AccountIdSchema.parse("account:reviewer-c"));

    expect(reviewer.workspaceId).not.toBe(CREDENTIAL_TEST_WORKSPACE_ID);
    await expect(storage.persistence.workspaces.getWorkspace(CREDENTIAL_TEST_WORKSPACE_ID)).resolves.toMatchObject({ approvalState: "APPROVED" });
  });
});
