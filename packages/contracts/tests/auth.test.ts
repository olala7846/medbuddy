import { describe, expect, it } from "vitest";

import {
  ActorContextSchema,
  ApiErrorSchema,
  AuthenticationMethodSchema,
  MemberIdSchema,
  WorkspaceIdSchema,
} from "../src/index.js";

describe("authentication contracts", () => {
  it("accepts an eligible Google prototype reviewer assuming a seeded workspace member", () => {
    const result = ActorContextSchema.safeParse({
      accountId: "account:reviewer-1",
      authentication: {
        kind: "GOOGLE_PROTOTYPE_REVIEWER",
        accountId: "account:reviewer-1",
        email: "reviewer@example.test",
        emailVerified: true,
        assumedMemberId: "member:owner-1",
      },
      effectiveMemberId: "member:owner-1",
      workspaceId: "workspace:demo-1",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a fixed credential actor without allowing a persona assumption", () => {
    const result = AuthenticationMethodSchema.safeParse({
      kind: "CREDENTIALS",
      accountId: "account:owner-1",
      fixedMemberId: "member:owner-1",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a credential actor that claims a reviewer persona", () => {
    const result = AuthenticationMethodSchema.safeParse({
      kind: "CREDENTIALS",
      accountId: "account:owner-1",
      fixedMemberId: "member:owner-1",
      assumedMemberId: "member:caregiver-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a Google actor when its effective member differs from the assumed persona", () => {
    const result = ActorContextSchema.safeParse({
      accountId: "account:reviewer-1",
      authentication: {
        kind: "GOOGLE_PROTOTYPE_REVIEWER",
        accountId: "account:reviewer-1",
        email: "reviewer@example.test",
        emailVerified: true,
        assumedMemberId: "member:owner-1",
      },
      effectiveMemberId: "member:caregiver-1",
      workspaceId: "workspace:demo-1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects identifiers with the wrong entity prefix", () => {
    expect(MemberIdSchema.safeParse("workspace:demo-1").success).toBe(false);
    expect(WorkspaceIdSchema.safeParse("member:owner-1").success).toBe(false);
  });

  it("validates the single public API error shape", () => {
    expect(
      ApiErrorSchema.safeParse({
        error: {
          code: "PROVIDER_ERROR",
          message: "The capture provider is temporarily unavailable.",
          retryable: true,
        },
      }).success,
    ).toBe(true);
  });
});
