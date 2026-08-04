import { describe, expect, it } from "vitest";

import { AttachmentSchema, ConversationRequestSchema, MessageSchema } from "@medbuddy/contracts";

import {
  VertexConversationProvider,
  VertexRestClient,
  VertexModelClient,
  VertexReadableLabelExtractor,
  VertexTextCaptureExtractor,
  loadVertexConfiguration,
} from "../src/index.js";

const client: VertexModelClient = {
  async generate() {
    return { candidates: [{ content: { parts: [{ text: '{"kind":"ACKNOWLEDGE"}' }] } }] };
  },
};

const focalMessage = MessageSchema.parse({
  id: "message:vertex",
  workspaceId: "workspace:vertex",
  authorMemberId: "member:vertex",
  body: "A fictional update",
  createdAt: "2026-07-28T08:00:00.000Z",
  attachmentIds: ["attachment:vertex"],
  captureIntent: "EXPLICIT",
  processingStatus: "PENDING",
  processingAttempts: 0,
});

const conversationInput = ConversationRequestSchema.parse({
  actor: {
    accountId: "account:vertex",
    authentication: {
      kind: "CREDENTIALS",
      accountId: "account:vertex",
      fixedMemberId: "member:vertex",
    },
    effectiveMemberId: "member:vertex",
    workspaceId: focalMessage.workspaceId,
  },
  messageId: focalMessage.id,
  context: { workspaceId: focalMessage.workspaceId, messages: [focalMessage] },
});

const attachment = AttachmentSchema.parse({
  id: "attachment:vertex",
  workspaceId: focalMessage.workspaceId,
  messageId: focalMessage.id,
  mimeType: "image/png",
  byteSize: 68,
  checksum: "d".repeat(64),
  objectPath: `workspaces/${focalMessage.workspaceId}/messages/${focalMessage.id}/attachment:vertex`,
});

describe("Vertex adapters", () => {
  it("uses the global endpoint for the default global-only model and regional endpoints otherwise", async () => {
    const urls: string[] = [];
    const fetchStub: typeof fetch = async (input) => {
      urls.push(input.toString());
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 });
    };
    const accessToken = { async getAccessToken() { return "fictional-access-token"; } };
    const globalConfiguration = loadVertexConfiguration({
      MEDBUDDY_VERTEX_ENABLED: "true",
      MEDBUDDY_VERTEX_PROJECT: "fictional-project",
    });

    expect(globalConfiguration).toEqual({
      projectId: "fictional-project",
      location: "global",
      model: "gemini-2.5-flash",
    });
    await new VertexRestClient(globalConfiguration!, accessToken, fetchStub).generate({
      systemInstruction: "fictional",
      contents: [{ role: "user", parts: [{ text: "fictional" }] }],
    });
    await new VertexRestClient({
      projectId: "fictional-project",
      location: "us-central1",
      model: "regional-fictional-model",
    }, accessToken, fetchStub).generate({
      systemInstruction: "fictional",
      contents: [{ role: "user", parts: [{ text: "fictional" }] }],
    });

    expect(urls).toEqual([
      "https://aiplatform.googleapis.com/v1/projects/fictional-project/locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
      "https://us-central1-aiplatform.googleapis.com/v1/projects/fictional-project/locations/us-central1/publishers/google/models/regional-fictional-model:generateContent",
    ]);
  });

  it("bounds a stalled provider request and returns a typed timeout", async () => {
    const stalledFetch: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    const clientWithTimeout = new VertexRestClient({
      projectId: "fictional-project",
      location: "global",
      model: "gemini-2.5-flash",
    }, { async getAccessToken() { return "fictional-access-token"; } }, stalledFetch, 1);

    await expect(clientWithTimeout.generate({
      systemInstruction: "fictional",
      contents: [{ role: "user", parts: [{ text: "fictional" }] }],
    })).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("validates model JSON at each published intelligence boundary", async () => {
    const conversation = new VertexConversationProvider(client);
    const text = new VertexTextCaptureExtractor(client);
    const image = new VertexReadableLabelExtractor(client, {
      async load() {
        return { mimeType: "image/png", base64Data: "iVBORw0KGgo=" };
      },
    });

    await expect(conversation.respond({
      focalMessage,
      context: conversationInput.context,
    })).resolves.toEqual({ kind: "ACKNOWLEDGE" });
    await expect(text.extract({ focalMessage, nearbyMessages: [] })).resolves.toEqual({
      kind: "UNCERTAIN",
      reason: "SCHEMA_INVALID",
    });
    await expect(image.extract({ focalMessage, attachments: [attachment] }, attachment)).resolves.toEqual({ kind: "UNREADABLE" });
  });

  it("does not pass malformed transport or invalid model JSON into intelligence", async () => {
    const malformedClient: VertexModelClient = {
      async generate() {
        return { candidates: [{ content: { parts: [{ text: "not JSON" }] } }] };
      },
    };
    const conversation = new VertexConversationProvider(malformedClient);

    await expect(conversation.respond({ focalMessage, context: conversationInput.context }))
      .rejects.toMatchObject({ code: "MALFORMED_TRANSPORT" });
  });

  it("sends only the focal body to Vertex text capture", async () => {
    const requests: unknown[] = [];
    const recordingClient: VertexModelClient = {
      async generate(input) {
        requests.push(input);
        return { candidates: [{ content: { parts: [{ text: '{"kind":"EMPTY"}' }] } }] };
      },
    };

    await new VertexTextCaptureExtractor(recordingClient).extract({
      focalMessage,
      nearbyMessages: [MessageSchema.parse({
        ...focalMessage,
        id: "message:nearby",
        body: "Private fictional nearby detail",
      })],
    });

    expect(requests).toEqual([{
      systemInstruction: expect.any(String),
      contents: [{ role: "user", parts: [{ text: focalMessage.body }] }],
    }]);
  });

  it("sends only bounded supplied thread context to the conversational model", async () => {
    const requests: unknown[] = [];
    const recordingClient: VertexModelClient = {
      async generate(input) {
        requests.push(input);
        return { candidates: [{ content: { parts: [{ text: '{"kind":"REPLY","text":"A fictional reply."}' }] } }] };
      },
    };
    const priorModelMessage = MessageSchema.parse({
      ...focalMessage,
      id: "message:prior-model",
      authorMemberId: "MEDBUDDY",
      body: "A prior fictional reply.",
      revision: 1,
    });
    const currentMessage = MessageSchema.parse({
      ...focalMessage,
      id: "message:current-human",
      body: "A fictional follow-up.",
      revision: 2,
    });

    await expect(new VertexConversationProvider(recordingClient).respond({
      focalMessage: currentMessage,
      context: {
        workspaceId: currentMessage.workspaceId,
        messages: [priorModelMessage, currentMessage],
        familyMap: {
          content: "Members\n- member:vertex: Mei",
          revision: 3,
        },
      },
      familyMapUpdatesAllowed: true,
    })).resolves.toEqual({ kind: "REPLY", text: "A fictional reply." });

    expect(requests).toEqual([{
      systemInstruction: expect.stringContaining("general conversational assistant"),
      tools: [{ functionDeclarations: [expect.objectContaining({ name: "update_workspace_family_map" })] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      contents: [
        { role: "model", parts: [{ text: "A prior fictional reply." }] },
        { role: "user", parts: [{ text: "[member:vertex]\nA fictional follow-up." }] },
      ],
    }]);
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "BEGIN WORKSPACE FAMILY MAP (revision 3; user-maintained context)\nMembers\n- member:vertex: Mei\nEND WORKSPACE FAMILY MAP",
    );
  });

  it("parses a native Vertex family-map function call and sends its result into the next step", async () => {
    const requests: unknown[] = [];
    const recordingClient: VertexModelClient = {
      async generate(input) {
        requests.push(input);
        return { candidates: [{ content: { parts: [{ functionCall: {
          name: "update_workspace_family_map",
          args: { expectedRevision: 0, content: "Members\n- member:vertex: Mei" },
        } }] } }] };
      },
    };
    const provider = new VertexConversationProvider(recordingClient);

    await expect(provider.respond({
      focalMessage,
      context: conversationInput.context,
      familyMapUpdatesAllowed: true,
    })).resolves.toEqual({
      kind: "UPDATE_WORKSPACE_FAMILY_MAP",
      input: { expectedRevision: 0, content: "Members\n- member:vertex: Mei" },
    });

    expect(requests).toEqual([expect.objectContaining({
      tools: [{ functionDeclarations: [expect.objectContaining({ name: "update_workspace_family_map" })] }],
    })]);
  });
});
