import { describe, expect, it } from "vitest";

import { AccountIdSchema, MemberIdSchema, WorkspaceIdSchema } from "@medbuddy/contracts";

import {
  authenticateGoogleReviewer,
  createSeededCredentialAuthenticator,
  hashCredentialPassword,
  resolveActor,
  type AuthResolutionDependencies,
  type CredentialSeed,
} from "../../src/index.js";

const accountId = (value: string) => AccountIdSchema.parse(value);
const memberId = (value: string) => MemberIdSchema.parse(value);
const workspaceId = (value: string) => WorkspaceIdSchema.parse(value);

const dependencies: AuthResolutionDependencies = {
  provisioner: {
    async getOrCreate(accountId) {
      return {
        accountId,
        workspaceId: workspaceId("workspace:reviewer-demo"),
        templateVersion: "golden-v1",
        createdAt: "2026-07-28T10:00:00.000Z",
      };
    },
    async reset() {
      throw new Error("Reset is outside B1.");
    },
  },
  seededMembers: {
    async belongsToWorkspace(memberId, workspaceId) {
      return (
        workspaceId === "workspace:reviewer-demo" &&
        ["member:owner", "member:caregiver"].includes(memberId)
      ) || (workspaceId === "workspace:credential-demo" && memberId === "member:credential");
    },
  },
};

describe("Google reviewer login and actor resolution", () => {
  it("allows verified exact-email and domain allowlist matches only", async () => {
    const exact = await authenticateGoogleReviewer(
      { accountId: accountId("account:reviewer"), email: "reviewer@example.test", emailVerified: true },
      { allowedEmails: ["reviewer@example.test"], allowedDomains: [] },
      dependencies.provisioner,
    );
    const domain = await authenticateGoogleReviewer(
      { accountId: accountId("account:reviewer"), email: "reviewer@demo.test", emailVerified: true },
      { allowedEmails: [], allowedDomains: ["demo.test"] },
      dependencies.provisioner,
    );
    const unverified = await authenticateGoogleReviewer(
      { accountId: accountId("account:reviewer"), email: "reviewer@example.test", emailVerified: false },
      { allowedEmails: ["reviewer@example.test"], allowedDomains: [] },
      dependencies.provisioner,
    );

    expect(exact?.workspace.workspaceId).toBe("workspace:reviewer-demo");
    expect(domain).not.toBeNull();
    expect(unverified).toBeNull();
  });

  it("only resolves a Google persona that is seeded in the reviewer mapping", async () => {
    const authenticated = await authenticateGoogleReviewer(
      { accountId: accountId("account:reviewer"), email: "reviewer@example.test", emailVerified: true },
      { allowedEmails: ["reviewer@example.test"], allowedDomains: [] },
      dependencies.provisioner,
    );
    expect(authenticated).not.toBeNull();
    if (!authenticated) throw new Error("Expected reviewer authentication.");

    await expect(
      resolveActor(
        { session: authenticated.session, workspaceId: workspaceId("workspace:reviewer-demo"), demoMemberHeader: "member:owner" },
        dependencies,
      ),
    ).resolves.toMatchObject({ effectiveMemberId: "member:owner" });
    await expect(
      resolveActor(
        { session: authenticated.session, workspaceId: workspaceId("workspace:other"), demoMemberHeader: "member:owner" },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(
      resolveActor(
        { session: authenticated.session, workspaceId: workspaceId("workspace:reviewer-demo"), demoMemberHeader: "member:unseeded" },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});

describe("seeded credentials", () => {
  async function credentialSeeds(): Promise<readonly CredentialSeed[]> {
    return [{
      username: "fictional-owner",
      accountId: accountId("account:credential"),
      fixedMemberId: memberId("member:credential"),
      passwordHash: await hashCredentialPassword("fictional-password"),
    }];
  }

  it("returns one generic failure for unknown accounts and bad passwords", async () => {
    const authenticate = createSeededCredentialAuthenticator(await credentialSeeds());

    await expect(authenticate("unknown", "incorrect")).resolves.toBeNull();
    await expect(authenticate("fictional-owner", "incorrect")).resolves.toBeNull();
    await expect(authenticate("fictional-owner", "fictional-password")).resolves.toMatchObject({
      fixedMemberId: "member:credential",
    });
  });

  it("ignores a persona header and retains the fixed seeded participant", async () => {
    const actor = await resolveActor(
      {
        session: {
          kind: "CREDENTIALS",
          accountId: accountId("account:credential"),
          fixedMemberId: memberId("member:credential"),
        },
        workspaceId: workspaceId("workspace:credential-demo"),
        demoMemberHeader: "member:owner",
      },
      dependencies,
    );

    expect(actor.effectiveMemberId).toBe("member:credential");
  });

  it("fails unauthenticated requests before any domain invocation", async () => {
    await expect(
      resolveActor({ workspaceId: workspaceId("workspace:credential-demo") }, dependencies),
    ).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });
});
