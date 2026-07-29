import { describe, expect, it } from "vitest";

import {
  ActorContextSchema,
  MessageSchema,
  type ChatService,
  type Message,
  type MessagePage,
} from "@medbuddy/contracts";

import {
  createPersistedChatTimeline,
  createAuthenticatedChatRoute,
  mountPersistedChatApp,
  renderLoginPage,
  type ChatBrowserForm,
  type ChatBrowserRoot,
  type ChatBrowserTextArea,
  type PersistedChatApi,
} from "../src/index.js";

const actor = ActorContextSchema.parse({
  accountId: "account:credential-owner",
  authentication: {
    kind: "CREDENTIALS",
    accountId: "account:credential-owner",
    fixedMemberId: "member:owner",
  },
  effectiveMemberId: "member:owner",
  workspaceId: "workspace:demo",
});

function message(input: {
  id: string;
  body: string;
  processingStatus: Message["processingStatus"];
  authorMemberId?: string;
  createdAt?: string;
  revision?: number;
}): Message {
  return MessageSchema.parse({
    id: input.id,
    workspaceId: "workspace:demo",
    authorMemberId: input.authorMemberId ?? "member:owner",
    body: input.body,
    createdAt: input.createdAt ?? "2026-07-29T12:00:00.000Z",
    attachmentIds: [],
    captureIntent: "PASSIVE",
    processingStatus: input.processingStatus,
    processingAttempts: 0,
    revision: input.revision ?? 1,
  });
}

function createApi(pages: MessagePage[]): PersistedChatApi & { sends: string[] } {
  const sends: string[] = [];
  return {
    sends,
    async listMessages(request) {
      expect(request.workspaceId).toBe("workspace:demo");
      return pages.shift() ?? { messages: [], nextRevision: 0 };
    },
    async sendMessage(input) {
      sends.push(input.body);
      return message({
        id: "message:human-new",
        body: input.body,
        processingStatus: "PENDING",
        revision: 6,
      });
    },
  };
}

describe("login and persisted chat timeline", () => {
  it("renders both login choices with plain-language descriptions", () => {
    const html = renderLoginPage();

    expect(html).toContain("Sign in with Google");
    expect(html).toContain("Use a fictional participant account");
  });

  it("shows persisted human and MedBuddy messages with readable, non-color-only processing states", async () => {
    const api = createApi([{
      messages: [
        message({ id: "message:pending", body: "I felt dizzy.", processingStatus: "PENDING", revision: 1 }),
        message({ id: "message:captured", body: "Captured item", processingStatus: "CAPTURED", revision: 2 }),
        message({ id: "message:ignored", body: "No health detail", processingStatus: "IGNORED", revision: 3 }),
        message({ id: "message:manual", body: "Hard to read", processingStatus: "NEEDS_MANUAL_REVIEW", revision: 4 }),
        message({ id: "message:failed", body: "Try again", processingStatus: "FAILED", revision: 5 }),
        message({ id: "message:buddy", authorMemberId: "MEDBUDDY", body: "I can help record that.", processingStatus: "IGNORED", revision: 6 }),
      ],
      nextRevision: 6,
    }]);
    const timeline = createPersistedChatTimeline({ workspaceId: actor.workspaceId, api, idempotencyKey: () => "send-1" });

    await timeline.load();
    const html = timeline.render();

    expect(html).toContain("MedBuddy");
    expect(html).toContain("<strong>Pending:</strong> waiting to be captured for review.");
    expect(html).toContain("<strong>Captured:</strong> available for review.");
    expect(html).toContain("<strong>Ignored:</strong> no item was captured.");
    expect(html).toContain("<strong>Manual review needed:</strong> capture was uncertain.");
    expect(html).toContain("<strong>Failed:</strong> capture could not finish.");
    expect(html).toContain('aria-label="Processing status: Captured"');
  });

  it("sends a message and polls a revision cursor for its persisted processing update", async () => {
    const api = createApi([
      { messages: [], nextRevision: 0 },
      {
        messages: [message({
          id: "message:human-new",
          body: "@MedBuddy Please record this.",
          processingStatus: "CAPTURED",
          revision: 7,
        })],
        nextRevision: 7,
      },
    ]);
    const timeline = createPersistedChatTimeline({ workspaceId: actor.workspaceId, api, idempotencyKey: () => "send-1" });

    await timeline.load();
    await timeline.send("@MedBuddy Please record this.");
    await timeline.poll();

    expect(api.sends).toEqual(["@MedBuddy Please record this."]);
    expect(timeline.messages).toMatchObject([{ id: "message:human-new", processingStatus: "CAPTURED" }]);
    expect(timeline.render()).toContain("<strong>Captured:</strong> available for review.");
  });

  it("loads every cursor page before it begins revision polling", async () => {
    const api = createApi([
      {
        messages: [message({ id: "message:first", body: "First", processingStatus: "PENDING", revision: 1 })],
        nextCursor: "message:first" as never,
        nextRevision: 1,
      },
      {
        messages: [message({ id: "message:second", body: "Second", processingStatus: "CAPTURED", revision: 2 })],
        nextRevision: 2,
      },
    ]);
    const timeline = createPersistedChatTimeline({ workspaceId: actor.workspaceId, api });

    await timeline.load();

    expect(timeline.messages.map((stored) => stored.id)).toEqual(["message:first", "message:second"]);
  });

  it("mounts an authenticated fake-backed browser flow with composer submission and polling", async () => {
    const seenActors: string[] = [];
    const chatService: ChatService = {
      async appendMessage(resolvedActor, input) {
        seenActors.push(resolvedActor.effectiveMemberId);
        return {
          message: message({ id: "message:sent", body: input.body, processingStatus: "PENDING", revision: 2 }),
          captureQueued: true,
        };
      },
      async listMessages(resolvedActor, query) {
        seenActors.push(resolvedActor.effectiveMemberId);
        if (query.afterRevision !== undefined) {
          return {
            messages: [message({
              id: "message:buddy",
              authorMemberId: "MEDBUDDY",
              body: "I can help record that.",
              processingStatus: "IGNORED",
              revision: 3,
            })],
            nextRevision: 3,
          };
        }
        return { messages: [], nextRevision: 0 };
      },
      async requestCaptureRetry() {},
    };
    const route = createAuthenticatedChatRoute({
      chatService,
      async resolveServerActor(workspaceId) {
        expect(workspaceId).toBe("workspace:demo");
        return actor;
      },
    });
    const root = new FakeBrowserRoot();
    const timeline = createPersistedChatTimeline({ workspaceId: actor.workspaceId, api: route, idempotencyKey: () => "send-1" });
    const app = await mountPersistedChatApp(root, timeline, { pollIntervalMs: 60_000 });

    const sent = root.nextRender();
    root.submit("@MedBuddy Please record this.");
    await sent;
    expect(root.innerHTML).toContain("@MedBuddy Please record this.");

    await app.poll();
    expect(root.innerHTML).toContain("I can help record that.");
    expect(seenActors).toEqual(["member:owner", "member:owner", "member:owner"]);
    app.unmount();
  });

  it("preserves the focused draft and reports detached send and poll failures", async () => {
    const api: PersistedChatApi = {
      async listMessages(query) {
        if (query.afterRevision !== undefined) throw new Error("temporary failure");
        return { messages: [], nextRevision: 0 };
      },
      async sendMessage() {
        throw new Error("temporary failure");
      },
    };
    const root = new FakeBrowserRoot();
    const timeline = createPersistedChatTimeline({ workspaceId: actor.workspaceId, api, idempotencyKey: () => "send-1" });
    const app = await mountPersistedChatApp(root, timeline, { pollIntervalMs: 60_000 });

    const sendFailed = root.nextRender();
    root.submit("draft message");
    await sendFailed;
    expect(root.innerHTML).toContain("Message was not sent. Your draft is still here; try again.");
    expect(root.draft).toBe("draft message");
    expect(root.composerIsFocused).toBe(true);

    root.setDraft("still writing");
    root.focusComposer();
    await app.poll();
    expect(root.innerHTML).toContain("Messages could not refresh. Your draft is still here; try again.");
    expect(root.draft).toBe("still writing");
    expect(root.composerIsFocused).toBe(true);
    app.unmount();
  });
});

class FakeBrowserForm implements ChatBrowserForm {
  #listener: ((event: { preventDefault(): void }) => void) | undefined;

  addEventListener(_type: "submit", listener: (event: { preventDefault(): void }) => void): void {
    this.#listener = listener;
  }

  submit(): void {
    this.#listener?.({ preventDefault() {} });
  }
}

class FakeBrowserRoot implements ChatBrowserRoot {
  #html = "";
  #form = new FakeBrowserForm();
  #textarea = new FakeBrowserTextArea(() => { this.#composerIsFocused = true; });
  #nextRender: (() => void) | undefined;
  #composerIsFocused = false;

  get innerHTML(): string {
    return this.#html;
  }

  set innerHTML(value: string) {
    this.#html = value;
    this.#form = new FakeBrowserForm();
    this.#textarea = new FakeBrowserTextArea(() => { this.#composerIsFocused = true; });
    this.#composerIsFocused = false;
    this.#nextRender?.();
    this.#nextRender = undefined;
  }

  querySelector(selector: "form"): ChatBrowserForm | null;
  querySelector(selector: "textarea"): ChatBrowserTextArea | null;
  querySelector(selector: "form" | "textarea"): ChatBrowserForm | ChatBrowserTextArea | null {
    return selector === "form" ? this.#form : this.#textarea;
  }

  submit(value: string): void {
    this.#textarea.value = value;
    this.#textarea.focus();
    this.#form.submit();
  }

  get draft(): string {
    return this.#textarea.value;
  }

  get composerIsFocused(): boolean {
    return this.#composerIsFocused;
  }

  get activeElement(): unknown {
    return this.#composerIsFocused ? this.#textarea : undefined;
  }

  setDraft(value: string): void {
    this.#textarea.value = value;
  }

  focusComposer(): void {
    this.#textarea.focus();
  }

  nextRender(): Promise<void> {
    return new Promise((resolve) => {
      this.#nextRender = resolve;
    });
  }
}

class FakeBrowserTextArea implements ChatBrowserTextArea {
  value = "";

  constructor(private readonly onFocus: () => void) {}

  focus(): void {
    this.onFocus();
  }
}
