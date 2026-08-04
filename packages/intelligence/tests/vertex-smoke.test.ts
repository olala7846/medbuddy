import { describe, expect, it } from "vitest";

import { AttachmentSchema, MessageSchema } from "@medbuddy/contracts";

import {
  ConversationResponder,
  VertexConversationProvider,
  VertexReadableLabelExtractor,
  VertexRestClient,
  VertexTextCaptureExtractor,
  loadVertexConfiguration,
} from "../src/index.js";

const runSmoke = process.env.MEDBUDDY_RUN_VERTEX_SMOKE === "true";
const configuration = runSmoke ? loadVertexConfiguration() : null;

function createConfiguredClient(): VertexRestClient {
  if (configuration === null) {
    throw new Error("Set MEDBUDDY_VERTEX_ENABLED=true and MEDBUDDY_VERTEX_PROJECT before running the live smoke test.");
  }
  return new VertexRestClient(configuration);
}

describe.runIf(runSmoke)("Vertex live smoke (fictional inputs only)", () => {
  async function runFamilyMapTurn(
    suffix: string,
    body: string,
    familyMap: { content: string; revision: number } = { content: "", revision: 0 },
    rejectUpdate = false,
  ) {
    const workspaceId = "workspace:vertex-fictional-family" as const;
    const focalMessage = MessageSchema.parse({
      id: `message:vertex-family-${suffix}`,
      workspaceId,
      authorMemberId: "member:vertex-fictional-mei",
      body,
      createdAt: "2026-08-04T12:00:00.000Z",
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "IGNORED",
      processingAttempts: 0,
    });
    const updates: { expectedRevision: number; content: string }[] = [];
    const responder = new ConversationResponder(
      { async lookup() { return []; } },
      new VertexConversationProvider(createConfiguredClient()),
      50_000,
    );
    const result = await responder.respond({
      messageId: focalMessage.id,
      context: {
        workspaceId: focalMessage.workspaceId,
        messages: [focalMessage],
        familyMap: { workspaceId: focalMessage.workspaceId, ...familyMap },
      },
    }, {
      updateWorkspaceFamilyMap: {
        async update(input) {
          updates.push(input);
          if (rejectUpdate) return { kind: "REJECTED", code: "CONTENT_TOO_LARGE" };
          return {
            kind: "UPDATED",
            familyMap: {
              workspaceId: focalMessage.workspaceId,
              content: input.content,
              revision: familyMap.revision + 1,
            },
          };
        },
      },
    });
    return { result, updates };
  }

  it("updates an explicit relationship and acknowledges only after the write", async () => {
    const { result, updates } = await runFamilyMapTurn("explicit", "I am Mei. Kai is my son.");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.content).toContain("Mei");
    expect(result).toMatchObject({ kind: "RESPONDED", toolCalls: 1 });
  });

  it("truthfully reports a rejected update instead of claiming it was saved", async () => {
    const { result, updates } = await runFamilyMapTurn(
      "rejected",
      "I am Mei. Kai is my son.",
      { content: "", revision: 0 },
      true,
    );
    expect(updates).toHaveLength(1);
    expect(result).toMatchObject({ kind: "RESPONDED", toolCalls: 1 });
    expect(result.responseText).toMatch(/couldn['’]?t|could not|wasn['’]?t|not saved|unable|failed|did not/i);
  });

  it("does not write an inferred relationship", async () => {
    const { updates } = await runFamilyMapTurn("inferred", "Mei brought Kai some tea today.");
    expect(updates).toEqual([]);
  });

  it("corrects one direct relationship while preserving unrelated lines", async () => {
    const map = "Members\n- member:vertex-fictional-mei: Mei\n- member:vertex-fictional-kai: Kai\n- member:vertex-fictional-lin: Lin\nDirect relationships\n- Mei is Kai's sister.\n- Lin is Mei's mother.";
    const { updates } = await runFamilyMapTurn("correction", "Correction: Mei is Kai's mother, not his sister.", { content: map, revision: 2 });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.content).toContain("Mei is Kai's mother");
    expect(updates[0]?.content).toContain("Lin is Mei's mother");
    expect(updates[0]?.content).not.toContain("Mei is Kai's sister");
  });

  it("inspects the supplied map without writing", async () => {
    const { result, updates } = await runFamilyMapTurn("inspect", "What do you remember about our family?", { content: "Direct relationships\n- Mei is Kai's mother.", revision: 1 });
    expect(updates).toEqual([]);
    expect(result).toMatchObject({ kind: "RESPONDED" });
  });

  it("forgets one relationship without deleting unrelated lines", async () => {
    const { updates } = await runFamilyMapTurn("forget", "Forget that Mei is Kai's mother.", { content: "Direct relationships\n- Mei is Kai's mother.\n- Lin is Mei's mother.", revision: 2 });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.content).not.toContain("Mei is Kai's mother");
    expect(updates[0]?.content).toContain("Lin is Mei's mother");
  });

  it("clears the complete map with empty replacement content", async () => {
    const { updates } = await runFamilyMapTurn("clear", "Forget everything in our family map.", { content: "Direct relationships\n- Mei is Kai's mother.", revision: 1 });
    expect(updates).toEqual([{ expectedRevision: 1, content: "" }]);
  });

  it("asks about an ambiguous reference without writing", async () => {
    const { result, updates } = await runFamilyMapTurn("ambiguous", "She is my mother.", { content: "Members\n- member:vertex-fictional-kai: Kai\n- member:vertex-fictional-lin: Lin", revision: 1 });
    expect(updates).toEqual([]);
    expect(result).toMatchObject({ kind: "RESPONDED" });
  });

  it("uses an indirect relationship conversationally without persisting it", async () => {
    const { result, updates } = await runFamilyMapTurn("indirect", "Who is Kai's grandmother?", { content: "Direct relationships\n- Mei is Kai's mother.\n- Lin is Mei's mother.", revision: 1 });
    expect(updates).toEqual([]);
    expect(result).toMatchObject({ kind: "RESPONDED" });
  });

  it("returns a schema-validated text extraction for a fictional message", async () => {
    const focalMessage = MessageSchema.parse({
      id: "message:vertex-fictional-text",
      workspaceId: "workspace:vertex-fictional",
      authorMemberId: "member:vertex-fictional",
      body: "I felt fictional mild dizziness after breakfast.",
      createdAt: "2026-07-28T08:00:00.000Z",
      attachmentIds: [],
      captureIntent: "PASSIVE",
      processingStatus: "PENDING",
      processingAttempts: 0,
    });
    const extractor = new VertexTextCaptureExtractor(createConfiguredClient());

    const result = await extractor.extract({ focalMessage, nearbyMessages: [] });

    expect(result).toMatchObject({ kind: expect.any(String) });
  });

  it("returns a schema-validated outcome for a fictional image", async () => {
    const focalMessage = MessageSchema.parse({
      id: "message:vertex-fictional-image",
      workspaceId: "workspace:vertex-fictional",
      authorMemberId: "member:vertex-fictional",
      body: "Please save this fictional printed label for review.",
      createdAt: "2026-07-28T08:00:00.000Z",
      attachmentIds: ["attachment:vertex-fictional"],
      captureIntent: "EXPLICIT",
      processingStatus: "PENDING",
      processingAttempts: 0,
    });
    const attachment = AttachmentSchema.parse({
      id: "attachment:vertex-fictional",
      workspaceId: focalMessage.workspaceId,
      messageId: focalMessage.id,
      mimeType: "image/png",
      byteSize: 68,
      checksum: "c".repeat(64),
      objectPath: `workspaces/${focalMessage.workspaceId}/messages/${focalMessage.id}/attachment:vertex-fictional`,
    });
    const extractor = new VertexReadableLabelExtractor(createConfiguredClient(), {
      async load() {
        // A 1×1 transparent PNG: it contains no person, medication, or health data.
        return {
          mimeType: "image/png",
          base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J4qQAAAAASUVORK5CYII=",
        };
      },
    });

    const result = await extractor.extract({ focalMessage, attachments: [attachment] }, attachment);

    expect(result).toMatchObject({ kind: expect.any(String) });
  });
});
