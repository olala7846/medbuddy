import { describe, expect, it } from "vitest";
import { MemoryFormationStateSchema } from "@medbuddy/contracts";
import { InMemoryContinuityRepository } from "../src/index.js";

const projector = (event: { workspaceId: string; id: string; sourceSequence: number; acceptedAt: string;
  authorMemberId: string; payload: { kind: string } }) => ({ workspaceId: event.workspaceId, sourceEventId: event.id,
  sourceSequence: event.sourceSequence, acceptedAt: event.acceptedAt,
  policyVersion: "memory-formation-v1" as const,
  kind: event.payload.kind === "TEXT" && event.authorMemberId !== "MEDBUDDY" ? "ELIGIBLE_HUMAN_TEXT" as const
    : event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND" ? "LIFECYCLE" as const : "EXCLUDED" as const,
  renderedUtf16: event.payload.kind === "TEXT" && event.authorMemberId !== "MEDBUDDY" ? 100 : 0 });

describe("in-memory accepted-event formation outbox", () => {
  it("atomically emits content-free eligibility metadata and deduplicates provider retries", async () => {
    const repository = new InMemoryContinuityRepository(undefined, projector as never);
    const input = {
      receiptKey: "event:formation-one", id: "source-event:formation-one",
      workspaceId: "workspace:formation-one", occurredAt: "2026-08-06T12:00:00.000Z",
      acceptedAt: "2026-08-06T12:00:01.000Z", providerMessageId: "message:formation-one",
      authorMemberId: "member:fictional", payload: { kind: "TEXT", body: "Fictional text.", replyRequested: true },
    } as const;
    await repository.acceptSourceEvent(input as never);
    await repository.acceptSourceEvent(input as never);
    const outbox = await repository.listAcceptedEvents({ workspaceId: input.workspaceId as never, afterCursor: 0, limit: 100, policyVersion: "memory-formation-v1" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ kind: "ELIGIBLE_HUMAN_TEXT", sourceSequence: 1 });
    expect(JSON.stringify(outbox)).not.toContain("Fictional text");
  });

  it("excludes bot text and attachments and schedules lifecycle metadata without count or size", async () => {
    const repository = new InMemoryContinuityRepository(undefined, projector as never);
    const common = { workspaceId: "workspace:formation-excluded", occurredAt: "2026-08-06T12:00:00.000Z",
      acceptedAt: "2026-08-06T12:00:01.000Z" };
    await repository.acceptSourceEvent({ ...common, receiptKey: "event:bot", id: "source-event:bot",
      providerMessageId: "message:bot", authorMemberId: "MEDBUDDY",
      payload: { kind: "TEXT", body: "Fictional output.", replyRequested: false } } as never);
    await repository.acceptSourceEvent({ ...common, receiptKey: "event:attachment", id: "source-event:attachment",
      authorMemberId: "member:fictional", payload: { kind: "ATTACHMENT", attachmentId: "attachment:x", mediaClass: "IMAGE" } } as never);
    await repository.acceptSourceEvent({ ...common, receiptKey: "event:unsend", id: "source-event:unsend",
      authorMemberId: "member:fictional", payload: { kind: "UNSEND", targetMessageId: "message:old" } } as never);
    await expect(repository.listAcceptedEvents({ workspaceId: common.workspaceId as never, afterCursor: 0, limit: 100, policyVersion: "memory-formation-v1" }))
      .resolves.toMatchObject([
        { kind: "EXCLUDED", renderedUtf16: 0 },
        { kind: "EXCLUDED", renderedUtf16: 0 },
        { kind: "LIFECYCLE", renderedUtf16: 0 },
      ]);
  });

  it("keeps production-small-production outboxes and scheduler state policy-isolated", async () => {
    let policyVersion: "memory-formation-v1" | "memory-formation-v1-verification-small" = "memory-formation-v1";
    const repository = new InMemoryContinuityRepository(undefined, ((event: Parameters<typeof projector>[0]) => ({
      ...projector(event), policyVersion,
    })) as never);
    const workspaceId = "workspace:formation-switch" as never;
    for (const [index, selected] of (["memory-formation-v1", "memory-formation-v1-verification-small", "memory-formation-v1"] as const).entries()) {
      policyVersion = selected;
      await repository.acceptSourceEvent({ receiptKey: `event:switch-${index}`, id: `source-event:switch-${index}`,
        workspaceId, occurredAt: `2026-08-06T12:0${index}:00.000Z`, acceptedAt: `2026-08-06T12:0${index}:01.000Z`,
        providerMessageId: `message:switch-${index}`, authorMemberId: "member:fictional",
        payload: { kind: "TEXT", body: "Fictional.", replyRequested: false } } as never);
    }
    await repository.compareAndSetState(null, MemoryFormationStateSchema.parse({ workspaceId,
      policyVersion: "memory-formation-v1", continuityPolicyVersion: "continuity-v1", cursor: 0, revision: 0,
      humanTextCount: 0, renderedUtf16: 0, scheduleGeneration: 0 }));
    await repository.compareAndSetState(null, MemoryFormationStateSchema.parse({ workspaceId,
      policyVersion: "memory-formation-v1-verification-small", continuityPolicyVersion: "continuity-v1-verification-small",
      cursor: 0, revision: 0, humanTextCount: 0, renderedUtf16: 0, scheduleGeneration: 0 }));
    await expect(repository.listAcceptedEvents({ workspaceId, afterCursor: 0, limit: 100,
      policyVersion: "memory-formation-v1" })).resolves.toMatchObject([{ sourceSequence: 1 }, { sourceSequence: 3 }]);
    await expect(repository.listAcceptedEvents({ workspaceId, afterCursor: 0, limit: 100,
      policyVersion: "memory-formation-v1-verification-small" })).resolves.toMatchObject([{ sourceSequence: 2 }]);
    await expect(repository.getState(workspaceId, "memory-formation-v1")).resolves.toMatchObject({ policyVersion: "memory-formation-v1" });
    await expect(repository.getState(workspaceId, "memory-formation-v1-verification-small"))
      .resolves.toMatchObject({ policyVersion: "memory-formation-v1-verification-small" });
  });

  it("returns a due workspace even when a full poison-outbox quota persists", async () => {
    const repository = new InMemoryContinuityRepository(undefined, projector as never);
    for (let index = 0; index < 100; index += 1) {
      await repository.acceptSourceEvent({ receiptKey: `event:poison-${index}`, id: `source-event:poison-${index}`,
        workspaceId: `workspace:poison-${String(index).padStart(3, "0")}`, occurredAt: "2026-08-06T12:00:00.000Z",
        acceptedAt: "2026-08-06T12:00:01.000Z", providerMessageId: `message:poison-${index}`,
        authorMemberId: "member:fictional", payload: { kind: "TEXT", body: "Fictional.", replyRequested: false } } as never);
    }
    const due = "workspace:zzzz-due" as never;
    await repository.compareAndSetState(null, MemoryFormationStateSchema.parse({ workspaceId: due,
      policyVersion: "memory-formation-v1", continuityPolicyVersion: "continuity-v1", cursor: 0, revision: 0,
      humanTextCount: 1, renderedUtf16: 10, firstSourceSequence: 1, lastSourceSequence: 1,
      firstAcceptedAt: "2026-08-06T11:00:00.000Z", newestAcceptedAt: "2026-08-06T11:00:00.000Z",
      quietDeadline: "2026-08-06T11:10:00.000Z", maximumAgeDeadline: "2026-08-07T11:00:00.000Z",
      scheduleGeneration: 1, scheduledFor: "2026-08-06T11:10:00.000Z" }));
    for (let sweep = 0; sweep < 2; sweep += 1) {
      await expect(repository.listRecoveryCandidates({ now: "2026-08-06T12:00:00.000Z", limit: 100,
        policyVersion: "memory-formation-v1" })).resolves.toContain(due);
    }
  });
});
