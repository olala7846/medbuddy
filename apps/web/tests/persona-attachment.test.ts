import { describe, expect, it } from "vitest";

import {
  ActorContextSchema,
  AttachmentIdSchema,
  MessageIdSchema,
  MessageSchema,
  WorkspaceIdSchema,
  type ChatService,
} from "@medbuddy/contracts";
import { InMemoryPersistence } from "@medbuddy/platform";

import {
  MEDBUDDY_DEMO_MEMBER_HEADER,
  createPersistedChatTimeline,
  createTabPersonaSelection,
  mountAuthenticatedChatApp,
  type ChatBrowserForm,
  type ChatBrowserAttachmentInput,
  type ChatBrowserRoot,
  type ChatBrowserTextArea,
} from "../src/index.js";
import * as BrowserApi from "../src/index.js";
import { createAuthenticatedChatRoute } from "../src/authenticated-chat-route.js";
import {
  createServerAttachmentAdmission,
  createServerAttachmentMetadata,
  MAX_ATTACHMENT_BYTES,
} from "../src/attachment-admission.server.js";

class FakeSessionStorage {
  #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }
}

class StaticBrowserForm implements ChatBrowserForm {
  addEventListener(): void {}
}

class StaticBrowserTextArea implements ChatBrowserTextArea {
  value = "";
}

class StaticBrowserAttachmentInput implements ChatBrowserAttachmentInput {
  files(): readonly [] {
    return [];
  }
}

class StaticBrowserRoot implements ChatBrowserRoot {
  innerHTML = "";
  #form = new StaticBrowserForm();
  #textarea = new StaticBrowserTextArea();
  #attachmentInput = new StaticBrowserAttachmentInput();

  querySelector(selector: "form"): ChatBrowserForm | null;
  querySelector(selector: "textarea"): ChatBrowserTextArea | null;
  querySelector(selector: "input"): ChatBrowserAttachmentInput | null;
  querySelector(selector: "form" | "textarea" | "input"): ChatBrowserForm | ChatBrowserTextArea | ChatBrowserAttachmentInput | null {
    if (selector === "form") return this.#form;
    if (selector === "textarea") return this.#textarea;
    return this.#attachmentInput;
  }
}

const workspaceId = WorkspaceIdSchema.parse("workspace:reviewer-demo");

describe("per-tab reviewer personas", () => {
  it("keeps server attachment admission out of the browser public entry point", () => {
    expect(BrowserApi).not.toHaveProperty("createServerAttachmentAdmission");
    expect(BrowserApi).not.toHaveProperty("createAuthenticatedChatRoute");
  });

  it("stores each Google reviewer's selected fictional participant in session storage and creates the approved header", () => {
    const firstTab = createTabPersonaSelection({ workspaceId, storage: new FakeSessionStorage(), isGoogleReviewer: true });
    const secondTab = createTabPersonaSelection({ workspaceId, storage: new FakeSessionStorage(), isGoogleReviewer: true });

    firstTab.select("member:owner");
    secondTab.select("member:caregiver");

    expect(firstTab.memberId).toBe("member:owner");
    expect(secondTab.memberId).toBe("member:caregiver");
    expect(firstTab.requestHeaders()).toEqual({ [MEDBUDDY_DEMO_MEMBER_HEADER]: "member:owner" });
    expect(secondTab.requestHeaders()).toEqual({ [MEDBUDDY_DEMO_MEMBER_HEADER]: "member:caregiver" });
  });

  it("does not provide a persona override for a fixed credential session", () => {
    const selection = createTabPersonaSelection({
      workspaceId,
      storage: new FakeSessionStorage(),
      isGoogleReviewer: false,
    });

    selection.select("member:owner");

    expect(selection.memberId).toBeUndefined();
    expect(selection.requestHeaders()).toEqual({});
  });
});

describe("server-owned attachment metadata", () => {
  it("permits only contract-approved image types and creates a private message-scoped path", () => {
    const attachment = createServerAttachmentMetadata({
      attachmentId: AttachmentIdSchema.parse("attachment:label"),
      workspaceId,
      messageId: MessageIdSchema.parse("message:visit-note"),
      mimeType: "image/png",
      byteSize: 128,
      checksum: "a".repeat(64),
    });

    expect(attachment.objectPath).toBe("workspaces/workspace:reviewer-demo/messages/message:visit-note/attachment:label");
    expect(attachment.mimeType).toBe("image/png");
  });

  it("rejects unsupported types and never accepts a browser-supplied object path", () => {
    expect(() => createServerAttachmentMetadata({
      attachmentId: AttachmentIdSchema.parse("attachment:document"),
      workspaceId,
      messageId: MessageIdSchema.parse("message:visit-note"),
      mimeType: "application/pdf",
      byteSize: 128,
      checksum: "a".repeat(64),
      objectPath: "outside-the-workspace",
    })).toThrow();
  });
});

describe("workspace requests and capture retry", () => {
  const actor = ActorContextSchema.parse({
    accountId: "account:reviewer",
    authentication: { kind: "GOOGLE_PROTOTYPE_REVIEWER", accountId: "account:reviewer", email: "reviewer@example.test", emailVerified: true, assumedMemberId: "member:owner" },
    effectiveMemberId: "member:owner",
    workspaceId,
  });

  it("forwards only the approved persona header to server-side actor resolution", async () => {
    const resolvedHeaders: Array<string | undefined> = [];
    const chatService: ChatService = {
      async appendMessage(_actor, input) {
        return {
          message: MessageSchema.parse({ id: "message:sent", workspaceId, authorMemberId: "member:owner", body: input.body, createdAt: "2026-07-29T12:00:00.000Z", attachmentIds: [], captureIntent: "PASSIVE", processingStatus: "PENDING", processingAttempts: 0, revision: 1 }),
          captureQueued: true,
        };
      },
      async listMessages() { return { messages: [], nextRevision: 0 }; },
      async requestCaptureRetry() {},
    };
    const route = createAuthenticatedChatRoute({
      chatService,
      attachmentAdmission: createServerAttachmentAdmission(),
      async resolveServerActor(_workspaceId, demoMemberHeader) {
        resolvedHeaders.push(demoMemberHeader);
        return actor;
      },
    });

    await route.listMessages(
      { workspaceId, limit: 20 },
      { headers: { [MEDBUDDY_DEMO_MEMBER_HEADER]: "member:owner", "X-Untrusted": "ignored" } },
    );

    expect(resolvedHeaders).toEqual(["member:owner"]);
  });

  it("renders image upload guidance and a retry control for a failed capture", async () => {
    const api = {
      async listMessages() {
        return {
          messages: [MessageSchema.parse({
            id: "message:failed",
            workspaceId,
            authorMemberId: "member:owner",
            body: "Fictional unreadable label.",
            createdAt: "2026-07-29T12:00:00.000Z",
            attachmentIds: [],
            captureIntent: "PASSIVE",
            processingStatus: "FAILED",
            processingAttempts: 1,
            revision: 1,
          })],
          nextRevision: 1,
        };
      },
      async sendMessage() { throw new Error("Not used in this test."); },
      async requestCaptureRetry() {},
    };
    const timeline = createPersistedChatTimeline({ workspaceId, api });

    await timeline.load();

    expect(timeline.render()).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(timeline.render()).toContain("Retry capture");
    await expect(timeline.retry(MessageIdSchema.parse("message:failed"))).resolves.toBeUndefined();
  });

  it("mounts a selected tab persona into every route request and submits server-admitted attachment IDs", async () => {
    const resolvedHeaders: Array<string | undefined> = [];
    const sentAttachmentIds: string[][] = [];
    const chatService: ChatService = {
      async appendMessage(_actor, input) {
        sentAttachmentIds.push([...input.attachmentIds]);
        return {
          message: MessageSchema.parse({ id: "message:human-8gxeav", workspaceId, authorMemberId: "member:owner", body: input.body, createdAt: "2026-07-29T12:00:00.000Z", attachmentIds: input.attachmentIds, captureIntent: "PASSIVE", processingStatus: "PENDING", processingAttempts: 0, revision: 1 }),
          captureQueued: true,
        };
      },
      async listMessages() { return { messages: [], nextRevision: 0 }; },
      async requestCaptureRetry() {},
    };
    const attachmentAdmission = createServerAttachmentAdmission();
    const route = createAuthenticatedChatRoute({
      chatService,
      attachmentAdmission,
      async resolveServerActor(_workspaceId, demoMemberHeader) {
        resolvedHeaders.push(demoMemberHeader);
        return actor;
      },
    });
    const persona = createTabPersonaSelection({ workspaceId, storage: new FakeSessionStorage(), isGoogleReviewer: true });
    persona.select("member:owner");
    const mounted = await mountAuthenticatedChatApp(new StaticBrowserRoot(), {
      workspaceId,
      api: route,
      personaSelection: persona,
      idempotencyKey: () => "send-1",
    });

    await mounted.timeline.send("Fictional label images.", [
      { mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) },
      { mimeType: "image/jpeg", bytes: new Uint8Array([4, 5, 6]) },
    ]);
    await mounted.timeline.poll();

    expect(resolvedHeaders).toEqual(["member:owner", "member:owner", "member:owner", "member:owner", "member:owner"]);
    expect(sentAttachmentIds).toHaveLength(1);
    expect(sentAttachmentIds[0]).toHaveLength(2);
    expect(new Set(sentAttachmentIds[0]).size).toBe(2);
    for (const attachmentId of sentAttachmentIds[0] ?? []) expect(attachmentId).toMatch(/^attachment:/);
  });

  it("persists contract-valid metadata and retains bytes in the server-only fixed store", async () => {
    const persistence = new InMemoryPersistence();
    const attachmentAdmission = createServerAttachmentAdmission({ attachmentRepository: persistence.attachments });
    const attachment = await attachmentAdmission.admit(actor, {
      workspaceId,
      idempotencyKey: "fixed-store-1",
      mimeType: "image/webp",
      bytes: new Uint8Array([7, 8, 9]),
    });

    await expect(
      persistence.attachments.getAttachment(attachment.workspaceId, attachment.messageId, attachment.id),
    ).resolves.toEqual(attachment);
    expect(attachmentAdmission.readServerBytes(attachment)).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("rejects an oversized upload before calculating its digest", async () => {
    let digestCalls = 0;
    const attachmentAdmission = createServerAttachmentAdmission({
      async digest() {
        digestCalls += 1;
        return "a".repeat(64);
      },
    });

    await expect(attachmentAdmission.admit(actor, {
      workspaceId,
      idempotencyKey: "too-large-1",
      mimeType: "image/png",
      bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
    })).rejects.toThrow("5 MiB");
    expect(digestCalls).toBe(0);
  });
});
