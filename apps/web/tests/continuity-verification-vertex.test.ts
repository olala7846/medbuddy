import { describe, expect, it } from "vitest";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { WorkspaceIdSchema } from "@medbuddy/contracts";
import {
  COMPACTION_MODEL_ID,
  CommittedSourceCardGrounding,
  CompactionSummaryGenerator,
  ConversationResponder,
  VertexConversationProvider,
  VertexRestClient,
  loadVertexConfiguration,
} from "@medbuddy/intelligence";
import { InMemoryContinuityRepository, InMemoryPersistence } from "@medbuddy/platform";

import { runSyntheticContinuityVerification } from "./support/continuity-verification-harness.js";
import {
  SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
  TRADITIONAL_CHINESE_CORRECTION,
  TRADITIONAL_CHINESE_RECENT_CONTENT,
} from "./support/continuity-verification-fixture.js";

const runEvaluation = process.env.MEDBUDDY_RUN_CONTINUITY_FAMILY_EVAL === "true";
const configuration = runEvaluation ? loadVertexConfiguration() : null;
const COUNTERFACTUAL_NAMES = new Map([
  ["銀之介", "柏岳"],
  ["野原鶴", "芷蘭"],
  ["廣志", "承遠"],
  ["美冴", "若晴"],
  ["小新", "昀澄"],
  ["小葵", "予安"],
] as const);

// Score relationship semantics independently of a known live-model tendency to
// nest or fence an additional REPLY envelope inside the user-visible reply text.
function semanticReplyText(response: string): string {
  let current = response.trim();
  for (let depth = 0; depth < 4; depth += 1) {
    const unfenced = current.replace(/^```json\s*/u, "").replace(/\s*```$/u, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(unfenced) as unknown;
    } catch {
      return current;
    }
    if (typeof parsed === "string") {
      current = parsed;
      continue;
    }
    if (typeof parsed === "object" && parsed !== null && "kind" in parsed && parsed.kind === "CALL") {
      throw new Error("The semantic reply contained a nested model-authored tool call.");
    }
    if (typeof parsed === "object" && parsed !== null && "kind" in parsed && "text" in parsed &&
        parsed.kind === "REPLY" && typeof parsed.text === "string") {
      current = parsed.text;
      continue;
    }
    return current;
  }
  return current;
}

function expectLabeledRelationshipLine(
  response: string,
  names: readonly string[],
  relationship: RegExp,
  evidenceKind: RegExp,
): void {
  const lines = response.split(/\r?\n|。/u).map((line) => line.trim()).filter(Boolean);
  expect(lines.some((line) => {
    const contrastsEvidenceKinds = /(?:不是|並非)[^。；]*(?:直接|推論|推得|間接)[^。；]*(?:而是|但)/u
      .test(line);
    const negatesClaim = /否認|無法確認|不確定/u.test(line) ||
      (/(?:不是|並非)/u.test(line) && !contrastsEvidenceKinds);
    return names.every((name) => line.includes(name)) &&
      relationship.test(line) && evidenceKind.test(line) && !negatesClaim;
  }), response).toBe(true);
}

async function createCounterfactualFixture(): Promise<{ path: string; url: URL }> {
  let raw = await readFile(SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL, "utf8");
  for (const [source, replacement] of COUNTERFACTUAL_NAMES) raw = raw.replaceAll(source, replacement);
  const path = join(tmpdir(), `medbuddy-counterfactual-family-${process.pid}-${Date.now()}.jsonl`);
  await writeFile(path, raw, { flag: "wx", mode: 0o600 });
  return { path, url: pathToFileURL(path) };
}

describe("continuity family-eval reply normalization", () => {
  it("unwraps plain, nested, and fenced replies but rejects a nested call", () => {
    expect(semanticReplyText("plain reply")).toBe("plain reply");
    expect(semanticReplyText(JSON.stringify(JSON.stringify({ kind: "REPLY", text: "nested reply" }))))
      .toBe("nested reply");
    expect(semanticReplyText(`\`\`\`json\n${JSON.stringify({ kind: "REPLY", text: "fenced reply" })}\n\`\`\``))
      .toBe("fenced reply");
    expect(() => semanticReplyText(JSON.stringify(JSON.stringify({ kind: "CALL", func: "invented" }))))
      .toThrow(/nested model-authored tool call/i);
  });

  it("requires an affirmative, correctly gendered in-law relationship", () => {
    expectLabeledRelationshipLine("芷蘭與若晴是推論出的婆媳關係。", ["芷蘭", "若晴"], /婆媳|婆婆|媳婦|兒媳|姻親/u, /推論/u);
    expectLabeledRelationshipLine(
      "芷蘭與若晴不是直接說明，而是推論出的婆媳關係。",
      ["芷蘭", "若晴"],
      /婆媳|婆婆|媳婦|兒媳|姻親/u,
      /推論/u,
    );
    expectLabeledRelationshipLine(
      "柏岳與承遠並非推論，而是直接說明的父子關係。",
      ["柏岳", "承遠"],
      /父子|父親|爸爸|兒子|之父|之子/u,
      /直接/u,
    );
    expect(() => expectLabeledRelationshipLine(
      "芷蘭與若晴並非推論出的婆媳關係。",
      ["芷蘭", "若晴"],
      /婆媳|婆婆|媳婦|兒媳|姻親/u,
      /推論/u,
    )).toThrow();
    expect(() => expectLabeledRelationshipLine(
      "芷蘭與若晴是推論出的公公關係。",
      ["芷蘭", "若晴"],
      /婆媳|婆婆|媳婦|兒媳|姻親/u,
      /推論/u,
    )).toThrow();
  });
});

describe.runIf(runEvaluation)("Traditional Chinese continuity Vertex evaluation", () => {
  it("evaluates sparse family-graph inference without persisting derived edges", async () => {
    if (configuration === null) throw new Error("Vertex configuration is required for this evaluation.");
    const persistence = new InMemoryPersistence();
    const responses: string[] = [];
    const counterfactualFixture = await createCounterfactualFixture();
    const liveResponder = new ConversationResponder(
      new CommittedSourceCardGrounding([]),
      new VertexConversationProvider(new VertexRestClient(configuration)),
      60_000,
    );

    try {
      const cleanup = await runSyntheticContinuityVerification({
        continuity: new InMemoryContinuityRepository(),
        messages: persistence.messages,
        familyMaps: persistence.familyMaps,
        receipts: persistence.externalEvents,
      }, {
        fixtureUrl: counterfactualFixture.url,
        runNonce: "sparse-family-vertex",
        modelAssertions: "STRUCTURAL",
        expectedCorrection: TRADITIONAL_CHINESE_CORRECTION,
        expectedRecentContent: TRADITIONAL_CHINESE_RECENT_CONTENT,
        responder: {
          async respond(request, tools) {
            const result = await liveResponder.respond(request, tools);
            if (result.kind === "RESPONDED" && result.responseText !== undefined) {
              responses.push(result.responseText);
            }
            return result;
          },
        },
        generator: new CompactionSummaryGenerator(new VertexRestClient({
          projectId: configuration.projectId,
          location: configuration.location,
          model: COMPACTION_MODEL_ID,
        })),
      });

      expect(responses).toHaveLength(2);
      const finalResponse = semanticReplyText(responses.at(-1)!);
      expectLabeledRelationshipLine(finalResponse, ["柏岳", "承遠"], /父子|父親|爸爸|兒子|之父|之子/u, /直接/u);
      expectLabeledRelationshipLine(finalResponse, ["芷蘭", "若晴"], /婆媳|婆婆|媳婦|兒媳|姻親/u, /推論|推得|間接/u);
      expectLabeledRelationshipLine(
        finalResponse,
        ["柏岳", "芷蘭", "昀澄", "予安"],
        /祖孫|祖父母|爺爺奶奶|孫/u,
        /推論|推得|間接/u,
      );
      const primaryWorkspace = WorkspaceIdSchema.parse(cleanup.workspaceIds[0]);
      await expect(persistence.familyMaps.get(primaryWorkspace)).resolves.toMatchObject({
        content: "",
        revision: 0,
      });
    } finally {
      await unlink(counterfactualFixture.path);
    }
  }, 240_000);
});
