import { describe, expect, it } from "vitest";

import {
  ConversationContextSchema,
  ReplaceWorkspaceFamilyMapInputSchema,
  WorkspaceFamilyMapContentSchema,
  WorkspaceFamilyMapSchema,
} from "../src/index.js";

describe("workspace family-map contracts", () => {
  it("normalizes newlines and surrounding whitespace", () => {
    expect(WorkspaceFamilyMapContentSchema.parse("  Members\r\n- member:a: Mei  \r\n"))
      .toBe("Members\n- member:a: Mei");
  });

  it("counts Unicode code points at the 4,000-character boundary", () => {
    expect(WorkspaceFamilyMapContentSchema.parse("𠮷".repeat(4_000))).toHaveLength(8_000);
    expect(() => WorkspaceFamilyMapContentSchema.parse("𠮷".repeat(4_001))).toThrow();
  });

  it("represents an absent map as empty revision zero", () => {
    expect(WorkspaceFamilyMapSchema.parse({
      workspaceId: "workspace:fictional-a",
      content: "",
      revision: 0,
    })).toEqual({
      workspaceId: "workspace:fictional-a",
      content: "",
      revision: 0,
    });
  });

  it("rejects invalid revisions and unknown replacement fields", () => {
    expect(() => ReplaceWorkspaceFamilyMapInputSchema.parse({
      workspaceId: "workspace:fictional-a",
      actorMemberId: "member:fictional-a",
      sourceMessageId: "message:fictional-a",
      expectedRevision: -1,
      content: "",
      updatedAt: "2026-08-04T12:00:00.000Z",
      workspaceOverride: "workspace:fictional-b",
    })).toThrow();
  });

  it("rejects a family map attributed to another workspace", () => {
    expect(() => ConversationContextSchema.parse({
      workspaceId: "workspace:fictional-a",
      messages: [{
        id: "message:fictional-a",
        workspaceId: "workspace:fictional-a",
        authorMemberId: "member:fictional-a",
        body: "Fictional.",
        createdAt: "2026-08-04T12:00:00.000Z",
        attachmentIds: [],
        captureIntent: "PASSIVE",
        processingStatus: "IGNORED",
        processingAttempts: 0,
      }],
      familyMap: { workspaceId: "workspace:fictional-b", content: "", revision: 0 },
    })).toThrow("family map");
  });
});
