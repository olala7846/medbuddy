import { describePassiveMemoryAdapterContract } from "@medbuddy/contracts/passive-memory-adapter-contract-tests";
import { describeDynamicMemoryRepositoryContract } from "@medbuddy/contracts/dynamic-memory-adapter-contract-tests";
import { PassiveMemoryJobSchema } from "@medbuddy/contracts";

import {
  InMemoryContinuityRepository,
  InMemoryMemorySourceFreshnessStore,
  InMemoryPassiveMemoryJobRepository,
  PassiveMemoryEvidenceReaderAdapter,
} from "../src/index.js";
import { describe, expect, it, vi } from "vitest";

describePassiveMemoryAdapterContract(() => {
  const continuity = new InMemoryContinuityRepository();
  const jobs = new InMemoryPassiveMemoryJobRepository(InMemoryMemorySourceFreshnessStore.untrackedForTests());
  return {
    continuity,
    evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
    jobs,
    memory: jobs,
    ledger: continuity,
  };
});

describeDynamicMemoryRepositoryContract(() => new InMemoryPassiveMemoryJobRepository(
  InMemoryMemorySourceFreshnessStore.untrackedForTests(),
));

describe("bounded passive-memory evidence access", () => {
  it("allows pending production and small-profile ranges to advance independent watermarks", async () => {
    const jobs = new InMemoryPassiveMemoryJobRepository(InMemoryMemorySourceFreshnessStore.untrackedForTests());
    const workspaceId = "workspace:profile-switch" as never;
    const makeJob = (formationPolicyVersion: "memory-formation-v1" | "memory-formation-v1-verification-small", first: number) =>
      PassiveMemoryJobSchema.parse({ id: `passive-memory-job:${formationPolicyVersion}-${first}`, workspaceId,
        firstSourceSequence: first, lastSourceSequence: first, policyVersion: "passive-memory-v1", formationPolicyVersion,
        status: "PENDING", attempts: 0, claimGeneration: 0, createdAt: "2026-08-06T12:00:00.000Z" });
    const production = await jobs.createOrGet(makeJob("memory-formation-v1", 3));
    const small = await jobs.createOrGet(makeJob("memory-formation-v1-verification-small", 2));
    for (const job of [production, small]) {
      const claim = await jobs.claimAttempt(workspaceId, job.id, "2026-08-06T12:01:00.000Z");
      if (claim.kind !== "CLAIMED") throw new Error("Expected profile-isolated claim.");
      const { attemptClaimedAt: _a, attemptLeaseExpiresAt: _e, ...released } = claim.job;
      void _a; void _e;
      await jobs.finish({ ...released, status: "COMPLETED" }, { jobId: job.id, claimGeneration: claim.job.claimGeneration });
    }
    await expect(jobs.getCursor(workspaceId, "memory-formation-v1")).resolves.toBe(3);
    await expect(jobs.getCursor(workspaceId, "memory-formation-v1-verification-small")).resolves.toBe(2);
  });

  it("rejects an oversized range before touching the source ledger", async () => {
    const readPassiveSourceRange = vi.fn(async () => []);
    const readPassiveTextLineage = vi.fn(async () => []);
    const reader = new PassiveMemoryEvidenceReaderAdapter({ readPassiveSourceRange, readPassiveTextLineage });
    await expect(reader.readEffectiveHumanText({
      workspaceId: "workspace:fictional" as never,
      firstSourceSequence: 1,
      lastSourceSequence: 101,
    })).rejects.toThrow(/bound/i);
    expect(readPassiveSourceRange).not.toHaveBeenCalled();
    expect(readPassiveTextLineage).not.toHaveBeenCalled();
  });

  it("uses only the capped range port for a self-contained range", async () => {
    const readPassiveSourceRange = vi.fn(async () => []);
    const readPassiveTextLineage = vi.fn(async () => []);
    const reader = new PassiveMemoryEvidenceReaderAdapter({ readPassiveSourceRange, readPassiveTextLineage });
    await reader.readEffectiveHumanText({
      workspaceId: "workspace:fictional" as never,
      firstSourceSequence: 1,
      lastSourceSequence: 2,
    });
    expect(readPassiveSourceRange).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    expect(readPassiveTextLineage).not.toHaveBeenCalled();
  });
});
