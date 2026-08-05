import { describe, expect, it } from "vitest";

import {
  COMPACTION_MODEL_ID,
  CompactionSummaryGenerator,
  VertexRestClient,
  type CompactionSummaryRequest,
} from "../src/index.js";

const runEvaluation = process.env.MEDBUDDY_RUN_COMPACTION_EVAL === "true";

function createGenerator(): CompactionSummaryGenerator {
  const projectId = process.env.MEDBUDDY_VERTEX_PROJECT?.trim();
  if (projectId === undefined || projectId.length === 0) {
    throw new Error("MEDBUDDY_VERTEX_PROJECT is required for the compaction evaluation.");
  }
  return new CompactionSummaryGenerator(new VertexRestClient({
    projectId,
    location: process.env.MEDBUDDY_VERTEX_LOCATION?.trim() || "global",
    model: COMPACTION_MODEL_ID,
  }));
}

async function evaluate(input: Omit<CompactionSummaryRequest, "workspaceId">) {
  return (await createGenerator().generate({
    workspaceId: "workspace:fictional-compaction-eval",
    ...input,
  })).summary;
}

function summaryText(summary: Awaited<ReturnType<typeof evaluate>>): string {
  return [
    summary.overview,
    ...summary.keyEvents.flatMap((event) => [event.text, event.attribution ?? ""]),
    ...summary.openLoops,
    ...summary.caveats,
  ].join(" ");
}

describe.runIf(runEvaluation)("Gemini compaction evaluation (fictional inputs only)", () => {
  it("preserves a correction, attribution, and the unresolved logistics", async () => {
    const summary = await evaluate({
      level: 1,
      firstSourceSequence: 1,
      lastSourceSequence: 3,
      allowedSourceSequences: [1, 2, 3],
      renderedInput: [
        "[member:fictional-morgan | source 1]\nFictional planning note: the pharmacy pickup is Wednesday.",
        "[member:fictional-morgan | source 2]\nCorrection: the fictional pharmacy pickup is Thursday, not Wednesday.",
        "[member:fictional-kai | source 3]\nKai still needs to confirm who will drive for the fictional pickup.",
        "[member:fictional-kai]\nHello! Thanks! Hello! Thanks! Hello! Thanks!",
      ].join("\n\n"),
    });

    const text = summaryText(summary);
    expect(text).toMatch(/Thursday/i);
    expect(text).toMatch(/fictional-(morgan|kai)|Morgan|Kai/i);
    expect(summary.openLoops.join(" ")).toMatch(/confirm|drive|driver|ride|transport/i);
  });

  it("keeps a fictional health report attributed and unresolved without adding medical advice", async () => {
    const summary = await evaluate({
      level: 1,
      firstSourceSequence: 11,
      lastSourceSequence: 12,
      allowedSourceSequences: [11, 12],
      renderedInput: [
        "[member:fictional-ana | source 11]\nAna reported fictional nausea after tea; the cause is uncertain.",
        "[member:fictional-bo | source 12]\nBo asked whether to call the fictional clinic. No clinician advice is available and the question remains unresolved.",
      ].join("\n\n"),
    });

    const text = summaryText(summary);
    expect(text).toMatch(/nausea/i);
    expect(text).toMatch(/fictional-(ana|bo)|Ana|Bo/i);
    expect(summary.openLoops.join(" ")).toMatch(/clinic|clinician|call|follow/i);
    expect(summary.caveats.join(" ")).toMatch(/report|uncertain|unverified|non-authoritative|medical|caus|clinician|advice/i);
    expect(text).not.toMatch(/diagnosed with|should (?:start|stop|change)|recommended dose/i);
  });

  it("re-compacts child summaries without emitting unverifiable source references", async () => {
    const summary = await evaluate({
      level: 2,
      firstSourceSequence: 1,
      lastSourceSequence: 12,
      allowedSourceSequences: [],
      renderedInput: [
        JSON.stringify({
          overview: "Morgan corrected a fictional pickup date.",
          keyEvents: [{
            text: "The fictional pickup is Thursday, not Wednesday.",
            attribution: "member:fictional-morgan",
            sourceSequence: 2,
          }],
          openLoops: ["Kai still needs to confirm transportation."],
          caveats: ["Derived conversation context is non-authoritative."],
        }),
        JSON.stringify({
          overview: "Ana reported fictional nausea with uncertain cause.",
          keyEvents: [{
            text: "Ana reported fictional nausea after tea.",
            attribution: "member:fictional-ana",
            sourceSequence: 11,
          }],
          openLoops: ["The fictional clinic follow-up remains unresolved."],
          caveats: ["No clinician advice was available."],
        }),
      ].join("\n\n"),
    });

    const text = summaryText(summary);
    expect(text).toMatch(/Thursday/i);
    expect(text).toMatch(/clinic|transport|drive|ride/i);
    expect(summary.openLoops.length).toBeGreaterThan(0);
    expect(summary.keyEvents.every((event) =>
      event.sourceSequence === undefined && event.verbatimExcerpt === undefined)).toBe(true);
  });
});
