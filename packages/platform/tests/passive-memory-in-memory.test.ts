import { describePassiveMemoryAdapterContract } from "@medbuddy/contracts/passive-memory-adapter-contract-tests";

import {
  InMemoryContinuityRepository,
  InMemoryPassiveMemoryJobRepository,
  PassiveMemoryEvidenceReaderAdapter,
} from "../src/index.js";
import { describe, expect, it, vi } from "vitest";

describePassiveMemoryAdapterContract(() => {
  const continuity = new InMemoryContinuityRepository();
  const jobs = new InMemoryPassiveMemoryJobRepository();
  return {
    continuity,
    evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
    jobs,
    memory: jobs,
    ledger: continuity,
  };
});

describe("bounded passive-memory evidence access", () => {
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
