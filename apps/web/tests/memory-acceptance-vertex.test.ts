import { readFile } from "node:fs/promises";

import { PassiveMemoryEvidenceBatchSchema, PassiveMemoryGeneratorOutputSchema } from "@medbuddy/contracts";
import {
  PASSIVE_MEMORY_MODEL_ID,
  VertexPassiveMemoryGenerator,
  VertexRestClient,
  loadVertexConfiguration,
} from "@medbuddy/intelligence";
import { describe, expect, it } from "vitest";

const runEvaluation = process.env.MEDBUDDY_RUN_MEMORY_ACCEPTANCE_EVAL === "true";
const configuration = runEvaluation ? loadVertexConfiguration() : null;

type EvaluationScenario = {
  scenario: "semantic" | "episodic" | "procedural";
  body: string;
  expected: Record<string, string> & { memoryType: "SEMANTIC" | "EPISODIC" | "PROCEDURAL" };
};

function normalizeTerminalPunctuation(value: string): string {
  return value.replace(/[。.!！?？]+$/u, "");
}

async function scenarios(): Promise<readonly EvaluationScenario[]> {
  const raw = await readFile(new URL("./fixtures/memory-acceptance-zh-TW.jsonl", import.meta.url), "utf8");
  return raw.trim().split("\n").map((line) => JSON.parse(line) as EvaluationScenario);
}

describe.runIf(runEvaluation)("Traditional Chinese dynamic-memory Vertex evaluation", () => {
  it("classifies all three governed record types from fictional source evidence", async () => {
    if (configuration === null) throw new Error("Vertex configuration is required for this evaluation.");
    let providerStatus: number | undefined;
    let providerIssuePaths: string[];
    const diagnosticRequest: typeof fetch = async (...request) => {
      const response = await fetch(...request);
      providerStatus = response.status;
      if (response.ok) {
        const transport = await response.clone().json() as {
          candidates?: readonly { content?: { parts?: readonly { text?: string }[] } }[];
        };
        const text = transport.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text !== undefined) {
          try {
            const parsed = PassiveMemoryGeneratorOutputSchema.safeParse(JSON.parse(text) as unknown);
            if (!parsed.success) providerIssuePaths = parsed.error.issues.map((issue) => issue.path.join("."));
          } catch {
            providerIssuePaths = ["NON_JSON"];
          }
        }
      }
      return response;
    };
    const generator = new VertexPassiveMemoryGenerator(new VertexRestClient({
      projectId: configuration.projectId,
      location: configuration.location,
      model: PASSIVE_MEMORY_MODEL_ID,
    }, undefined, diagnosticRequest));

    for (const [index, scenario] of (await scenarios()).entries()) {
      providerStatus = undefined;
      providerIssuePaths = [];
      const sourceRef = `source-event:memory-eval-${scenario.scenario}`;
      let output: Awaited<ReturnType<VertexPassiveMemoryGenerator["generate"]>>;
      try {
        output = await generator.generate(PassiveMemoryEvidenceBatchSchema.parse({
        workspaceId: "workspace:memory-eval-fictional",
        firstSourceSequence: index + 1,
        lastSourceSequence: index + 1,
        evidence: [{
          workspaceId: "workspace:memory-eval-fictional",
          canonicalSourceRef: sourceRef,
          canonicalSource: {
            id: sourceRef,
            workspaceId: "workspace:memory-eval-fictional",
            sourceSequence: index + 1,
            occurredAt: `2026-08-06T12:0${index}:00.000Z`,
            acceptedAt: `2026-08-06T12:0${index}:01.000Z`,
            providerMessageId: `message:memory-eval-${scenario.scenario}`,
            authorMemberId: "member:memory-eval-fictional",
            payload: { kind: "TEXT", body: scenario.body, replyRequested: false },
          },
          sourceSequence: index + 1,
          providerMessageId: `message:memory-eval-${scenario.scenario}`,
          authorMemberId: "member:memory-eval-fictional",
          effectiveText: scenario.body,
          sourceKind: "TEXT",
          lineageSourceRefs: [sourceRef],
          acceptedAt: `2026-08-06T12:0${index}:01.000Z`,
        }],
        }));
      } catch (error) {
        throw new Error(
          `Passive-memory Vertex evaluation failed with HTTP ${providerStatus ?? "unavailable"}; schema paths ${providerIssuePaths.join(",") || "none"}.`,
          {
          cause: error,
          },
        );
      }
      expect(output.output.proposals).toHaveLength(1);
      const proposal = output.output.proposals[0]!;
      expect(proposal.sourceRef).toBe(sourceRef);
      expect(proposal.payload.memoryType).toBe(scenario.expected.memoryType);
      const actualPayload = proposal.payload as unknown as Record<string, unknown>;
      for (const field of ["statement", "event", "preference", "preferenceKind", "appliesTo"] as const) {
        const expected = scenario.expected[field];
        if (expected !== undefined) {
          expect(normalizeTerminalPunctuation(String(actualPayload[field])))
            .toBe(normalizeTerminalPunctuation(expected));
        }
      }
      expect([...proposal.payload.subjectLabels, ...proposal.tags].every((span) => scenario.body.includes(span)))
        .toBe(true);
    }
  }, 180_000);
});
