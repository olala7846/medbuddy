import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { CommittedSourceCardGrounding, ConversationResponder } from "@medbuddy/intelligence";
import { WorkspaceIdSchema } from "@medbuddy/contracts";
import { InMemoryContinuityRepository, InMemoryPersistence } from "@medbuddy/platform";
import { describe, expect, it } from "vitest";

import {
  DeepSeekV4ConversationEvaluationProvider,
  loadDeepSeekV4ConversationEvaluationConfiguration,
  summarizeDeepSeekV4Evaluation,
  type DeepSeekV4EvaluationMetadata,
} from "./support/deepseek-v4-conversation-evaluation.js";
import { runSyntheticContinuityVerification } from "./support/continuity-verification-harness.js";
import { SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL } from "./support/continuity-verification-fixture.js";

const runEvaluation = process.env.MEDBUDDY_RUN_DEEPSEEK_V4_CONVERSATION_EVAL === "true";

const COUNTERFACTUAL_NAMES = new Map([
  ["銀之介", "德明"],
  ["野原鶴", "秀蘭"],
  ["廣志", "志宏"],
  ["美冴", "雅婷"],
  ["小新", "家豪"],
  ["小葵", "欣怡"],
] as const);

async function createCounterfactualFixture(run: number): Promise<{ path: string; url: URL }> {
  let raw = await readFile(SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL, "utf8");
  for (const [source, replacement] of COUNTERFACTUAL_NAMES) raw = raw.replaceAll(source, replacement);
  const path = join(tmpdir(), `medbuddy-deepseek-v4-fictional-${process.pid}-${Date.now()}-${run}.jsonl`);
  await writeFile(path, raw, { flag: "wx", mode: 0o600 });
  return { path, url: pathToFileURL(path) };
}

function isTraditionalChineseReply(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value) && !/[\p{Script=Latin}]{4,}/u.test(value);
}

describe.runIf(runEvaluation)("DeepSeek V4 fictional Traditional Chinese continuity evaluation", () => {
  it("repeats the signed scenario without tools or family-map writes", async () => {
    const configuration = loadDeepSeekV4ConversationEvaluationConfiguration();
    const metadata: DeepSeekV4EvaluationMetadata[] = [];

    try {
      for (let run = 1; run <= configuration.runs; run += 1) {
      const persistence = new InMemoryPersistence();
      const fixture = await createCounterfactualFixture(run);
      const provider = new DeepSeekV4ConversationEvaluationProvider(configuration);
      const responses: string[] = [];
      const responder = new ConversationResponder(
        new CommittedSourceCardGrounding([]),
        provider,
        65_000,
      );
      try {
        const cleanup = await runSyntheticContinuityVerification({
          continuity: new InMemoryContinuityRepository(),
          messages: persistence.messages,
          familyMaps: persistence.familyMaps,
          receipts: persistence.externalEvents,
        }, {
          fixtureUrl: fixture.url,
          runNonce: `deepseek-v4-${run}`,
          modelAssertions: "STRUCTURAL",
          responder: {
            async respond(request, tools) {
              const result = await responder.respond(request, tools);
              if (result.kind === "RESPONDED" && result.responseText !== undefined) responses.push(result.responseText);
              return result;
            },
          },
        });
        expect(responses).toHaveLength(2);
        expect(responses.every(isTraditionalChineseReply)).toBe(true);
        await expect(persistence.familyMaps.get(WorkspaceIdSchema.parse(cleanup.workspaceIds[0]))).resolves.toMatchObject({
          content: "",
          revision: 0,
        });
        expect(provider.metadata().every((entry) => entry.status === "SUCCEEDED")).toBe(true);
        expect(provider.metadata().every((entry) => entry.returnedModelId === configuration.model)).toBe(true);
      } finally {
        metadata.push(...provider.metadata());
        await unlink(fixture.path);
      }
      }
    } catch (error) {
      // This remains content-free when a provider rejects a request.
      console.info(JSON.stringify({
        evaluation: "deepseek-v4-fictional-continuity",
        ...summarizeDeepSeekV4Evaluation(metadata),
      }));
      throw error;
    }

    const summary = summarizeDeepSeekV4Evaluation(metadata);
    // This is deliberately content-free: no prompts, replies, identifiers, or reasoning.
    console.info(JSON.stringify({ evaluation: "deepseek-v4-fictional-continuity", ...summary }));
    expect(summary.passRate).toBe(1);
    expect(summary.routing).not.toEqual({});
  }, 240_000);
});
