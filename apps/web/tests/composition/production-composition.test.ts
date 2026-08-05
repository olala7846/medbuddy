import { describe, expect, it } from "vitest";
import { determineWorkspaceEligibility } from "@medbuddy/care-record";
import { InMemoryDemoWorkspacePersistence } from "@medbuddy/platform";
import { AccountIdSchema, HandoffVersionIdSchema } from "@medbuddy/contracts";

import {
  CREDENTIAL_TEST_WORKSPACE_ID,
  FictionalDemoWorkspaceProvisioner,
  seedCredentialTestWorkspace,
} from "../../src/composition/demo-workspace.js";
import { createLineWebhookComposition } from "../../src/composition/line.js";
import { LineWebhookHandler } from "../../src/line/index.js";
import {
  LineConfigurationError,
  ProductionConfigurationError,
  loadContinuityConfiguration,
  loadLangSmithTracingConfiguration,
  loadLineConfiguration,
  loadProductionConfig,
} from "../../src/composition/config.js";

const productionEnvironment = {
  MEDBUDDY_GCP_PROJECT_ID: "fictional-project",
  MEDBUDDY_TASKS_LOCATION: "us-central1",
  MEDBUDDY_TASKS_QUEUE: "capture",
  MEDBUDDY_CAPTURE_CALLBACK_URL: "https://fictional.example.test/api/internal/capture",
  MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL: "tasks@fictional-project.iam.gserviceaccount.com",
  MEDBUDDY_ATTACHMENT_BUCKET: "fictional-medbuddy-private",
  MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION: "locator-v1",
  MEDBUDDY_ATTACHMENT_LOCATOR_KEY: Buffer.alloc(32, 7).toString("base64"),
  MEDBUDDY_CONTINUITY_CALLBACK_URL: "https://fictional.example.test/api/internal/continuity",
  MEDBUDDY_ATTACHMENT_CALLBACK_URL: "https://fictional.example.test/api/internal/attachment",
  MEDBUDDY_VERTEX_ENABLED: "true",
  MEDBUDDY_VERTEX_PROJECT: "fictional-project",
  MEDBUDDY_VERTEX_LOCATION: "global",
  MEDBUDDY_VERTEX_MODEL: "gemini-3.6-flash",
};

describe("production composition configuration", () => {
  it("keeps LangSmith tracing default-off and ignores generic LangSmith environment variables", () => {
    expect(loadLangSmithTracingConfiguration({
      LANGSMITH_TRACING: "true",
      LANGSMITH_API_KEY: "must-not-enable",
    })).toBeNull();
  });

  it("requires the complete dedicated fictional LangSmith configuration when enabled", () => {
    const environment = {
      MEDBUDDY_LANGSMITH_TRACING_ENABLED: "true",
      MEDBUDDY_LANGSMITH_SERVICE_KEY: "fictional-service-key",
      MEDBUDDY_LANGSMITH_PROJECT: "medbuddy-effort2-fictional",
      MEDBUDDY_LANGSMITH_WORKSPACE_ID: "langsmith-workspace-fictional",
      MEDBUDDY_LANGSMITH_API_URL: "https://api.smith.langchain.com",
      MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID: "workspace:fictional-tracing",
      MEDBUDDY_LANGSMITH_VERIFICATION_ID: "effort2-fictional-verification",
    };

    expect(loadLangSmithTracingConfiguration(environment)).toEqual({
      serviceKey: "fictional-service-key",
      project: "medbuddy-effort2-fictional",
      langSmithWorkspaceId: "langsmith-workspace-fictional",
      apiUrl: "https://api.smith.langchain.com",
      allowedMedBuddyWorkspaceId: "workspace:fictional-tracing",
      verificationId: "effort2-fictional-verification",
    });

    const incomplete = { ...environment, MEDBUDDY_LANGSMITH_SERVICE_KEY: "" };
    expect(() => loadLangSmithTracingConfiguration(incomplete)).toThrow("MEDBUDDY_LANGSMITH_SERVICE_KEY");
    expect(() => loadLangSmithTracingConfiguration(incomplete)).not.toThrow("fictional-service-key");
  });

  it("rejects non-approved LangSmith endpoints", () => {
    expect(() => loadLangSmithTracingConfiguration({
      MEDBUDDY_LANGSMITH_TRACING_ENABLED: "true",
      MEDBUDDY_LANGSMITH_SERVICE_KEY: "fictional-service-key",
      MEDBUDDY_LANGSMITH_PROJECT: "medbuddy-effort2-fictional",
      MEDBUDDY_LANGSMITH_WORKSPACE_ID: "langsmith-workspace-fictional",
      MEDBUDDY_LANGSMITH_API_URL: "https://example.test",
      MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID: "workspace:fictional-tracing",
      MEDBUDDY_LANGSMITH_VERIFICATION_ID: "effort2-fictional-verification",
    })).toThrow("MEDBUDDY_LANGSMITH_API_URL");
  });

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

  it("loads LINE secrets without including them in errors or returned diagnostics", () => {
    const lineEnvironment = {
      MEDBUDDY_GCP_PROJECT_ID: "fictional-project",
      MEDBUDDY_LINE_CHANNEL_SECRET: "fictional-channel-secret",
      MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN: "fictional-channel-access-token",
    };
    expect(loadLineConfiguration(lineEnvironment)).toEqual({
      projectId: "fictional-project",
      channelSecret: "fictional-channel-secret",
      channelAccessToken: "fictional-channel-access-token",
    });

    const incomplete = { ...lineEnvironment, MEDBUDDY_LINE_CHANNEL_SECRET: "" };
    expect(() => loadLineConfiguration(incomplete)).toThrow(LineConfigurationError);
    expect(() => loadLineConfiguration(incomplete)).toThrow("MEDBUDDY_LINE_CHANNEL_SECRET");
    expect(() => loadLineConfiguration(incomplete)).not.toThrow("fictional-channel-access-token");
  });

  it("requires the approved private task, storage, and Gemini settings without echoing values", () => {
    expect(loadContinuityConfiguration(productionEnvironment)).toEqual({
      projectId: "fictional-project",
      tasksLocation: "us-central1",
      tasksQueue: "capture",
      continuityCallbackUrl: "https://fictional.example.test/api/internal/continuity",
      attachmentCallbackUrl: "https://fictional.example.test/api/internal/attachment",
      taskServiceAccountEmail: "tasks@fictional-project.iam.gserviceaccount.com",
      attachmentBucket: "fictional-medbuddy-private",
      attachmentLocatorKeyVersion: "locator-v1",
      attachmentLocatorKeyBase64: Buffer.alloc(32, 7).toString("base64"),
      vertexProjectId: "fictional-project",
      vertexLocation: "global",
      vertexModel: "gemini-3.6-flash",
    });
    const wrongModel = { ...productionEnvironment, MEDBUDDY_VERTEX_MODEL: "fictional-wrong-model" };
    expect(() => loadContinuityConfiguration(wrongModel)).toThrow(ProductionConfigurationError);
    expect(() => loadContinuityConfiguration(wrongModel)).toThrow("MEDBUDDY_VERTEX_MODEL");
    expect(() => loadContinuityConfiguration(wrongModel)).not.toThrow("fictional-wrong-model");
    const invalidKey = { ...productionEnvironment, MEDBUDDY_ATTACHMENT_LOCATOR_KEY: "fictional-invalid-secret" };
    expect(() => createLineWebhookComposition({
      ...invalidKey,
      MEDBUDDY_LINE_CHANNEL_SECRET: "fictional-channel-secret",
      MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN: "fictional-channel-access-token",
    }, { logger: { write() {} } })).toThrow(/key/i);
    expect(() => createLineWebhookComposition({
      ...invalidKey,
      MEDBUDDY_LINE_CHANNEL_SECRET: "fictional-channel-secret",
      MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN: "fictional-channel-access-token",
    }, { logger: { write() {} } })).not.toThrow("fictional-invalid-secret");
  });

  it("constructs the LINE conversation boundary without contacting live providers", () => {
    const handler = createLineWebhookComposition({
      ...productionEnvironment,
      MEDBUDDY_LINE_CHANNEL_SECRET: "fictional-channel-secret",
      MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN: "fictional-channel-access-token",
    }, { logger: { write() {} } });

    expect(handler).toBeInstanceOf(LineWebhookHandler);
  });

  it("rejects a LINE runtime configured with a model other than the approved target", () => {
    expect(() => createLineWebhookComposition({
      ...productionEnvironment,
      MEDBUDDY_LINE_CHANNEL_SECRET: "fictional-channel-secret",
      MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN: "fictional-channel-access-token",
      MEDBUDDY_VERTEX_MODEL: "fictional-wrong-model",
    }, { logger: { write() {} } })).toThrow("MEDBUDDY_VERTEX_MODEL");
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
