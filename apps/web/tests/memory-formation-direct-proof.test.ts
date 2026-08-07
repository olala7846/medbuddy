import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MemoryFormationScheduler } from "@medbuddy/chat";
import { MEMORY_FORMATION_POLICIES } from "@medbuddy/contracts";
import {
  InMemoryContinuityRepository,
  InMemoryMemorySourceFreshnessStore,
  InMemoryPassiveMemoryJobRepository,
} from "@medbuddy/platform";

describe("memory-formation-direct-proof", () => {
  for (const filename of ["memory-formation-production.jsonl", "memory-formation-verification-small.jsonl"]) {
    it(`dispatches the exact rendered ceiling from ${filename}`, async () => {
      const fixture = JSON.parse((await readFile(new URL(`./fixtures/${filename}`, import.meta.url), "utf8")).trim()) as {
        profile: "production" | "verification-small"; targetRenderedUtf16: number; bodySeed: string;
      };
      const continuity = new InMemoryContinuityRepository();
      const jobs = new InMemoryPassiveMemoryJobRepository(InMemoryMemorySourceFreshnessStore.untrackedForTests());
      const workspaceId = `workspace:formation-${fixture.profile}` as never;
      const input = { receiptKey: `event:${fixture.profile}`, id: `source-event:${fixture.profile}`, workspaceId,
        occurredAt: "2026-08-06T12:00:00.000Z", acceptedAt: "2026-08-06T12:00:01.000Z",
        providerMessageId: `message:${fixture.profile}`, authorMemberId: "member:fictional",
        payload: { kind: "TEXT", body: fixture.bodySeed, replyRequested: true } };
      await continuity.acceptSourceEvent(input as never);
      const initial = (await continuity.listAcceptedEvents({ workspaceId, afterCursor: 0, limit: 1 }))[0]!;
      const requiredDelta = fixture.targetRenderedUtf16 - initial.renderedUtf16;
      expect(requiredDelta % 2).toBe(0);
      const padding = "字".repeat(requiredDelta / 2);
      const exactContinuity = new InMemoryContinuityRepository();
      await exactContinuity.acceptSourceEvent({ ...input, payload: { ...input.payload, body: input.payload.body + padding } } as never);
      const [exact] = await exactContinuity.listAcceptedEvents({ workspaceId, afterCursor: 0, limit: 1 });
      expect(exact?.renderedUtf16).toBe(fixture.targetRenderedUtf16);
      const dispatched: unknown[] = [];
      const scheduler = new MemoryFormationScheduler({ repository: exactContinuity, jobs,
        wakeDispatcher: { async dispatch() {} }, workerDispatcher: { async dispatch(value) { dispatched.push(value); } },
        policy: MEMORY_FORMATION_POLICIES[fixture.profile], now: () => "2026-08-06T12:00:02.000Z" });
      await scheduler.reconcileWorkspace(workspaceId);
      expect(dispatched).toHaveLength(1);
    });
  }
});
