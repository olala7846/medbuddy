import { readFile } from "node:fs/promises";

import { DynamicMemoryService } from "@medbuddy/chat";
import {
  PassiveMemoryJobSchema,
  SourceEventSchema,
  WorkspaceIdSchema,
} from "@medbuddy/contracts";
import {
  InMemoryContinuityRepository,
  InMemoryMemorySourceFreshnessStore,
  InMemoryPassiveMemoryJobRepository,
  PassiveMemoryEvidenceReaderAdapter,
} from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import { PassiveMemoryWorker } from "../src/composition/passive-memory.js";

type FixtureRow = {
  kind: "TEXT" | "TEXT_EDIT";
  id: string;
  providerMessageId: string;
  authorMemberId: string;
  body: string;
  replyRequested?: boolean;
  targetMessageId?: string;
};

describe("passive-memory-direct-proof", () => {
  it("runs the realistic fictional Traditional Chinese JSONL without credentials or replies", async () => {
    const raw = await readFile(new URL("./fixtures/passive-memory-zh-TW.jsonl", import.meta.url), "utf8");
    const rows = raw.trim().split("\n").map((line) => JSON.parse(line) as FixtureRow);
    const workspaceId = WorkspaceIdSchema.parse("workspace:passive-zh-proof");
    const freshness = new InMemoryMemorySourceFreshnessStore();
    const continuity = new InMemoryContinuityRepository(freshness);
    for (const [index, row] of rows.entries()) {
      const event = SourceEventSchema.parse({
        id: row.id,
        workspaceId,
        sourceSequence: index + 1,
        occurredAt: `2026-08-06T12:0${index}:00.000Z`,
        acceptedAt: `2026-08-06T12:0${index}:01.000Z`,
        providerMessageId: row.providerMessageId,
        authorMemberId: row.authorMemberId,
        payload: row.kind === "TEXT"
          ? { kind: "TEXT", body: row.body, replyRequested: row.replyRequested ?? false }
          : { kind: "TEXT_EDIT", targetMessageId: row.targetMessageId, body: row.body },
      });
      const { sourceSequence: _sequence, ...input } = event;
      void _sequence;
      await continuity.acceptSourceEvent({ ...input, receiptKey: `event:passive-zh-${index}` });
    }
    const jobs = new InMemoryPassiveMemoryJobRepository(freshness);
    const job = await jobs.createOrGet(PassiveMemoryJobSchema.parse({
      id: "passive-memory-job:passive-zh-proof",
      workspaceId,
      firstSourceSequence: 1,
      lastSourceSequence: rows.length,
      policyVersion: "passive-memory-v1",
      status: "PENDING",
      attempts: 0,
      claimGeneration: 0,
      createdAt: "2026-08-06T13:00:00.000Z",
    }));
    const memories = jobs;
    const worker = new PassiveMemoryWorker({
      jobs,
      evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
      generator: {
        async generate(input) {
          const language = input.evidence.find((item) => item.canonicalSourceRef === "source-event:passive-zh-language");
          const folder = input.evidence.find((item) => item.canonicalSourceRef === "source-event:passive-zh-edit");
          if (language === undefined || folder === undefined) throw new Error("Expected effective fictional evidence.");
          return { output: { proposals: [{
            sourceRef: language.canonicalSourceRef,
            payload: {
              memoryType: "PROCEDURAL",
              preference: "請用繁體中文回覆。",
              preferenceKind: "LANGUAGE",
              appliesTo: "ALL_RESPONSES",
              subjectLabels: [],
            },
            tags: [],
          }, {
            sourceRef: folder.canonicalSourceRef,
            payload: {
              memoryType: "SEMANTIC",
              statement: "虛構的藍色資料夾放在玄關櫃子上。",
              subjectLabels: [],
            },
            tags: [],
          }] } };
        },
      },
      memory: new DynamicMemoryService(memories, () => "2026-08-06T13:01:00.000Z"),
      now: () => "2026-08-06T13:00:01.000Z",
      logger: { write() {} },
    });

    await expect(worker.run({ workspaceId, jobId: job.id })).resolves.toBe("COMPLETED");
    const records = await memories.listActive(workspaceId, 10);
    expect(records).toHaveLength(2);
    expect(records.find((record) => record.canonicalSource.sourceRef === "source-event:passive-zh-edit"))
      .toMatchObject({
        canonicalSource: {
          lineageSourceRefs: ["source-event:passive-zh-original", "source-event:passive-zh-edit"],
        },
        payload: { statement: "虛構的藍色資料夾放在玄關櫃子上。" },
      });
    expect(JSON.stringify(records)).not.toContain("可能");
    expect(JSON.stringify(records)).not.toContain("沒有");
    await expect(jobs.getCursor(workspaceId)).resolves.toBe(rows.length);
  });
});
