import { describe, expect, it } from "vitest";

import {
  DemoWorkspaceMappingSchema,
  DemoWorkspaceResetInputSchema,
  type DemoWorkspaceProvisioner,
} from "../src/index.js";

describe("prototype reviewer demo workspace contracts", () => {
  it("publishes a persistent account-to-workspace mapping", () => {
    expect(
      DemoWorkspaceMappingSchema.parse({
        accountId: "account:prototype-reviewer-1",
        workspaceId: "workspace:reviewer-demo-1",
        templateVersion: "golden-v1",
        createdAt: "2026-07-28T10:00:00.000Z",
      }),
    ).toBeTruthy();
  });

  it("requires an idempotency key when a reviewer explicitly resets their demo", async () => {
    const provisioner: DemoWorkspaceProvisioner = {
      async getOrCreate() {
        return DemoWorkspaceMappingSchema.parse({
          accountId: "account:prototype-reviewer-1",
          workspaceId: "workspace:reviewer-demo-1",
          templateVersion: "golden-v1",
          createdAt: "2026-07-28T10:00:00.000Z",
        });
      },
      async reset() {
        return DemoWorkspaceMappingSchema.parse({
          accountId: "account:prototype-reviewer-1",
          workspaceId: "workspace:reviewer-demo-2",
          templateVersion: "golden-v1",
          createdAt: "2026-07-28T10:05:00.000Z",
          replacedWorkspaceId: "workspace:reviewer-demo-1",
        });
      },
    };

    const resetInput = DemoWorkspaceResetInputSchema.parse({
      accountId: "account:prototype-reviewer-1",
      idempotencyKey: "reset-1",
    });
    const previous = await provisioner.getOrCreate(resetInput.accountId);
    const replacement = await provisioner.reset(resetInput);

    expect(replacement.workspaceId).not.toBe(previous.workspaceId);
    expect(replacement.replacedWorkspaceId).toBe(previous.workspaceId);
  });
});
