import { describe, expect, it } from "vitest";

import { AttachmentSchema, ConversationRequestSchema, MessageSchema } from "@medbuddy/contracts";

import {
  CommittedSourceCardGrounding,
  buildVertexGenerateContentBody,
  CONVERSATION_MAX_OUTPUT_TOKENS,
  CONVERSATION_PROVIDER_REQUEST_MAX_UTF16,
  ConversationResponder,
  VertexConversationProvider,
  type VertexGenerationRequest,
  type VertexInvocationContext,
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
  it("serializes the current JSON response format without adding deprecated MIME configuration", () => {
    const responseFormat = [{
      text: {
        mimeType: "APPLICATION_JSON",
        schema: { type: "object", required: ["overview"] },
      },
    }];

    const body = buildVertexGenerateContentBody({
      systemInstruction: "Return fictional JSON.",
      contents: [{ role: "user", parts: [{ text: "Fictional input." }] }],
      generationConfig: { responseFormat } as never,
    });

    expect(body).toMatchObject({ generationConfig: { responseFormat } });
    expect(body).not.toHaveProperty("generationConfig.responseMimeType");
  });

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
      model: "gemini-3.6-flash",
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
      "https://aiplatform.googleapis.com/v1/projects/fictional-project/locations/global/publishers/google/models/gemini-3.6-flash:generateContent",
      "https://us-central1-aiplatform.googleapis.com/v1/projects/fictional-project/locations/us-central1/publishers/google/models/regional-fictional-model:generateContent",
    ]);
  });

  it("keeps the declaration and reserves bounded output for AUTO and NONE tool steps", async () => {
    const bodies: unknown[] = [];
    const fetchStub: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as unknown);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 });
    };
    const client = new VertexRestClient({
      projectId: "fictional-project",
      location: "global",
      model: "gemini-2.5-flash",
    }, { async getAccessToken() { return "fictional-access-token"; } }, fetchStub);

    await client.generate({
      systemInstruction: "fictional",
      contents: [{ role: "user", parts: [{ text: "fictional" }] }],
      tools: [{ functionDeclarations: [] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { maxOutputTokens: CONVERSATION_MAX_OUTPUT_TOKENS },
    });
    await client.generate({
      systemInstruction: "fictional",
      contents: [{ role: "user", parts: [{ text: "fictional continuation" }] }],
      tools: [{ functionDeclarations: [{ name: "update_workspace_family_map" }] }],
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
      generationConfig: { maxOutputTokens: CONVERSATION_MAX_OUTPUT_TOKENS },
    });

    expect(bodies).toEqual([
      expect.objectContaining({
        tools: [{ functionDeclarations: [] }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      }),
      expect.objectContaining({
        tools: [{ functionDeclarations: [{ name: "update_workspace_family_map" }] }],
        toolConfig: { functionCallingConfig: { mode: "NONE" } },
      }),
    ]);
  });

  it("bounds the complete conversational provider request including wrappers", async () => {
    const requests: VertexGenerationRequest[] = [];
    const contexts: Array<VertexInvocationContext | undefined> = [];
    const recordingClient: VertexModelClient = {
      async generate(input, context) {
        requests.push(input);
        contexts.push(context);
        return { candidates: [{ content: { parts: [{ text: '{"kind":"ACKNOWLEDGE"}' }] } }] };
      },
    };
    const boundedInput = ConversationRequestSchema.parse({
      ...conversationInput,
      context: {
        ...conversationInput.context,
        assembledContext: {
          workspaceId: focalMessage.workspaceId,
          focalSourceEventId: "source-event:vertex",
          system: "s".repeat(8_000),
          familyMap: "f".repeat(4_000),
          agentActions: "a".repeat(4_000),
          history: "h".repeat(18_800),
          recentConversation: "r".repeat(4_900),
          omittedSourceEventCount: 1,
        },
      },
    });

    await new VertexConversationProvider(recordingClient).respond({
      focalMessage,
      context: boundedInput.context,
    });

    expect(JSON.stringify(requests[0]).length).toBeLessThanOrEqual(
      CONVERSATION_PROVIDER_REQUEST_MAX_UTF16,
    );
    expect(requests[0]?.generationConfig).toEqual({
      maxOutputTokens: CONVERSATION_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: "LOW" },
    });
    expect(contexts).toEqual([{ workspaceId: "workspace:vertex" }]);
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

  it("does not pass malformed transport into intelligence", async () => {
    const malformedClient: VertexModelClient = {
      async generate() {
        return { candidates: [{ unexpected: "missing content" }] };
      },
    };
    const conversation = new VertexConversationProvider(malformedClient);

    await expect(conversation.respond({ focalMessage, context: conversationInput.context }))
      .rejects.toMatchObject({ code: "MALFORMED_TRANSPORT" });
  });

  it("accepts bounded plain final text when family-map updates are disabled", async () => {
    const plainTextClient: VertexModelClient = {
      async generate() {
        return { candidates: [{ content: { role: "model", parts: [{ text: "Lin is Kai’s grandmother." }] } }] };
      },
    };

    await expect(new VertexConversationProvider(plainTextClient).respond({
      focalMessage,
      context: conversationInput.context,
      familyMapUpdatesAllowed: false,
    })).resolves.toEqual({ kind: "REPLY", text: "Lin is Kai’s grandmother." });
  });

  it("rejects empty and oversized plain conversational text", async () => {
    for (const text of ["   ", "x".repeat(5_001)]) {
      const invalidClient: VertexModelClient = {
        async generate() {
          return { candidates: [{ content: { role: "model", parts: [{ text }] } }] };
        },
      };
      await expect(new VertexConversationProvider(invalidClient).respond({
        focalMessage,
        context: conversationInput.context,
        familyMapUpdatesAllowed: true,
      })).rejects.toMatchObject({ code: "MALFORMED_TRANSPORT" });
    }
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
          workspaceId: currentMessage.workspaceId,
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
      generationConfig: {
        maxOutputTokens: CONVERSATION_MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
      contents: [
        { role: "model", parts: [{ text: "A prior fictional reply." }] },
        { role: "user", parts: [{ text: "[member:vertex]\nA fictional follow-up." }] },
      ],
    }]);
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "BEGIN WORKSPACE FAMILY MAP (revision 3; user-maintained context)\nMembers\n- member:vertex: Mei\nEND WORKSPACE FAMILY MAP",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "Never invent a person or name from a vague reference.",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "copy the full opaque ID byte-for-byte including its member: prefix",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "Explicitly named relatives do not need to be LINE participants",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "Participants\n- Mei (member:example)\n\nNamed relatives\n- Kai\n\nDirect relationships\n- Mei is the mother of Kai.",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "A LINE join event or greeting alone never links a participant identity",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "if the stated name appears in more than one Named relatives entry",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).toContain(
      "never preserve or emit the Members heading",
    );
    expect((requests[0] as { systemInstruction: string }).systemInstruction).not.toContain(
      "Never invent a member or add a person who has not been observed in this workspace.",
    );
  });

  it("parses a native Vertex family-map function call and sends its result into the next step", async () => {
    const requests: unknown[] = [];
    const recordingClient: VertexModelClient = {
      async generate(input) {
        requests.push(input);
        if (requests.length > 1) {
          return { candidates: [{ content: { role: "model", parts: [{ text: "Okay—I updated the map." }] } }] };
        }
        return { candidates: [{ content: { role: "model", parts: [{
          functionCall: {
            name: "update_workspace_family_map",
            args: { expectedRevision: 0, content: "Members\n- member:vertex: Mei" },
          },
          thoughtSignature: "fictional-thought-signature",
        }] } }] };
      },
    };
    const provider = new VertexConversationProvider(recordingClient);

    await expect(provider.respond({
      focalMessage,
      context: conversationInput.context,
      familyMapUpdatesAllowed: true,
      familyMapUpdateRequired: true,
    })).resolves.toEqual({
      kind: "UPDATE_WORKSPACE_FAMILY_MAP",
      input: { expectedRevision: 0, content: "Members\n- member:vertex: Mei" },
      continuation: {
        role: "model",
        parts: [{
          functionCall: {
            name: "update_workspace_family_map",
            args: { expectedRevision: 0, content: "Members\n- member:vertex: Mei" },
          },
          thoughtSignature: "fictional-thought-signature",
        }],
      },
    });

    expect(requests).toEqual([expect.objectContaining({
      tools: [{ functionDeclarations: [expect.objectContaining({ name: "update_workspace_family_map" })] }],
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
    })]);

    const continuation = {
      role: "model" as const,
      parts: [{
        functionCall: {
          name: "update_workspace_family_map",
          args: { expectedRevision: 0, content: "Members\n- member:vertex: Mei" },
        },
        thoughtSignature: "fictional-thought-signature",
      }],
    };
    await provider.respond({
      focalMessage,
      context: conversationInput.context,
      familyMapUpdatesAllowed: false,
      toolResult: {
        call: { expectedRevision: 0, content: "Members\n- member:vertex: Mei" },
        result: { kind: "NO_CHANGE", familyMap: conversationInput.context.familyMap },
        continuation,
      },
    });
    expect((requests[1] as { contents: unknown[] }).contents.slice(-2)).toEqual([
      continuation,
      {
        role: "user",
        parts: [{
          functionResponse: {
            name: "update_workspace_family_map",
            response: { kind: "NO_CHANGE", familyMap: conversationInput.context.familyMap },
          },
        }],
      },
    ]);
    expect(requests[1]).toMatchObject({
      tools: [{ functionDeclarations: [expect.objectContaining({ name: "update_workspace_family_map" })] }],
      toolConfig: { functionCallingConfig: { mode: "NONE" } },
      generationConfig: {
        maxOutputTokens: CONVERSATION_MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: "LOW" },
      },
    });
  });

  it("rejects a call outside the restricted ANY allow-list", async () => {
    const invalidClient: VertexModelClient = {
      async generate() {
        return { candidates: [{ content: { role: "model", parts: [{
          functionCall: { name: "query_memory", args: { query: "preferences" } },
        }] } }] };
      },
    };
    const provider = new VertexConversationProvider(invalidClient);

    await expect(provider.respond({
      focalMessage,
      context: conversationInput.context,
      familyMapUpdatesAllowed: true,
      familyMapUpdateRequired: true,
      toolDeclarations: [{
        name: "query_memory",
        description: "Read bounded synthetic workspace memory.",
        parameters: {
          type: "OBJECT",
          properties: { query: { type: "STRING" } },
          required: ["query"],
        },
      }],
    })).rejects.toMatchObject({ code: "MALFORMED_TRANSPORT" });
  });

  it.each([
    ["parallel calls", [
      { functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 0, content: "First" } } },
      { functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 0, content: "Second" } } },
    ]],
    ["a call plus extra text", [
      { functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 0, content: "First" } } },
      { text: "Also do something else." },
    ]],
  ])("rejects %s in one model content", async (_label, parts) => {
    const invalidClient: VertexModelClient = {
      async generate() {
        return { candidates: [{ content: { role: "model", parts } }] };
      },
    };
    await expect(new VertexConversationProvider(invalidClient).respond({
      focalMessage,
      context: conversationInput.context,
      familyMapUpdatesAllowed: true,
    })).rejects.toMatchObject({ code: "MALFORMED_TRANSPORT" });
  });

  it("carries both conflict-retry exchanges and thought signatures into step three", async () => {
    const requests: VertexGenerationRequest[] = [];
    let modelStep = 0;
    const retryClient: VertexModelClient = {
      async generate(input) {
        requests.push(input);
        modelStep += 1;
        if (modelStep === 1) return { candidates: [{ content: { role: "model", parts: [{
          functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 0, content: "First" } },
          thoughtSignature: "fictional-signature-a",
        }] } }] };
        if (modelStep === 2) return { candidates: [{ content: { role: "model", parts: [{
          functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 2, content: "Current plus correction" } },
          thoughtSignature: "fictional-signature-b",
        }] } }] };
        return { candidates: [{ content: { role: "model", parts: [{ text: "Okay—I updated the relationship." }] } }] };
      },
    };
    let attempts = 0;
    const responder = new ConversationResponder(
      new CommittedSourceCardGrounding([]),
      new VertexConversationProvider(retryClient),
    );
    const explicitFocal = MessageSchema.parse({ ...focalMessage, body: "Mei is Kai's mother." });

    await expect(responder.respond({
      messageId: focalMessage.id,
      context: { ...conversationInput.context, messages: [explicitFocal] },
    }, {
      updateWorkspaceFamilyMap: {
        async update(input) {
          attempts += 1;
          return attempts === 1
            ? {
                kind: "REVISION_CONFLICT",
                familyMap: { workspaceId: focalMessage.workspaceId, content: "Current", revision: 2 },
              }
            : {
                kind: "UPDATED",
                familyMap: { workspaceId: focalMessage.workspaceId, content: input.content, revision: 3 },
              };
        },
      },
    })).resolves.toMatchObject({ kind: "RESPONDED", toolCalls: 2 });

    expect(requests[2]?.contents.slice(-4)).toEqual([
      {
        role: "model",
        parts: [{
          functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 0, content: "First" } },
          thoughtSignature: "fictional-signature-a",
        }],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "update_workspace_family_map", response: expect.objectContaining({ kind: "REVISION_CONFLICT" }) } }],
      },
      {
        role: "model",
        parts: [{
          functionCall: { name: "update_workspace_family_map", args: { expectedRevision: 2, content: "Current plus correction" } },
          thoughtSignature: "fictional-signature-b",
        }],
      },
      {
        role: "user",
        parts: [{ functionResponse: { name: "update_workspace_family_map", response: expect.objectContaining({ kind: "UPDATED" }) } }],
      },
    ]);
    expect(requests.map((request) => request.toolConfig)).toEqual([
      { functionCallingConfig: { mode: "AUTO" } },
      { functionCallingConfig: { mode: "ANY" } },
      { functionCallingConfig: { mode: "NONE" } },
    ]);
  });
});
