import { describe, expect, it } from "vitest";

import { ActorContextSchema, MessageSchema, type ActorContext, type Message, type MessagePage } from "@medbuddy/contracts";

import {
  createPersistedChatTimeline,
  renderLoginPage,
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
    async listMessages(_actor: ActorContext, request) {
      expect(request.workspaceId).toBe("workspace:demo");
      return pages.shift() ?? { messages: [], nextRevision: 0 };
    },
    async sendMessage(_actor: ActorContext, input) {
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
    const timeline = createPersistedChatTimeline({ actor, api, idempotencyKey: () => "send-1" });

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
    const timeline = createPersistedChatTimeline({ actor, api, idempotencyKey: () => "send-1" });

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
    const timeline = createPersistedChatTimeline({ actor, api });

    await timeline.load();

    expect(timeline.messages.map((stored) => stored.id)).toEqual(["message:first", "message:second"]);
  });
});
