import { describe, expect, it } from "vitest";
import { InMemoryContinuityRepository } from "../src/index.js";

describe("in-memory accepted-event formation outbox", () => {
  it("atomically emits content-free eligibility metadata and deduplicates provider retries", async () => {
    const repository = new InMemoryContinuityRepository();
    const input = {
      receiptKey: "event:formation-one", id: "source-event:formation-one",
      workspaceId: "workspace:formation-one", occurredAt: "2026-08-06T12:00:00.000Z",
      acceptedAt: "2026-08-06T12:00:01.000Z", providerMessageId: "message:formation-one",
      authorMemberId: "member:fictional", payload: { kind: "TEXT", body: "Fictional text.", replyRequested: true },
    } as const;
    await repository.acceptSourceEvent(input as never);
    await repository.acceptSourceEvent(input as never);
    const outbox = await repository.listAcceptedEvents({ workspaceId: input.workspaceId as never, afterCursor: 0, limit: 100 });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: "ELIGIBLE_HUMAN_TEXT", sourceSequence: 1 });
    expect(JSON.stringify(outbox)).not.toContain("Fictional text");
  });

  it("excludes bot text and attachments and schedules lifecycle metadata without count or size", async () => {
    const repository = new InMemoryContinuityRepository();
    const common = { workspaceId: "workspace:formation-excluded", occurredAt: "2026-08-06T12:00:00.000Z",
      acceptedAt: "2026-08-06T12:00:01.000Z" };
    await repository.acceptSourceEvent({ ...common, receiptKey: "event:bot", id: "source-event:bot",
      providerMessageId: "message:bot", authorMemberId: "MEDBUDDY",
      payload: { kind: "TEXT", body: "Fictional output.", replyRequested: false } } as never);
    await repository.acceptSourceEvent({ ...common, receiptKey: "event:attachment", id: "source-event:attachment",
      authorMemberId: "member:fictional", payload: { kind: "ATTACHMENT", attachmentId: "attachment:x", mediaClass: "IMAGE" } } as never);
    await repository.acceptSourceEvent({ ...common, receiptKey: "event:unsend", id: "source-event:unsend",
      authorMemberId: "member:fictional", payload: { kind: "UNSEND", targetMessageId: "message:old" } } as never);
    await expect(repository.listAcceptedEvents({ workspaceId: common.workspaceId as never, afterCursor: 0, limit: 100 }))
      .resolves.toMatchObject([
        { kind: "EXCLUDED", renderedUtf16: 0 },
        { kind: "EXCLUDED", renderedUtf16: 0 },
        { kind: "LIFECYCLE", renderedUtf16: 0 },
      ]);
  });
});
