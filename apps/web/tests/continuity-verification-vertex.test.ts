import { describe, expect, it } from "vitest";

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

// Score relationship semantics independently of a known live-model tendency to
// nest or fence an additional REPLY envelope inside the user-visible reply text.
function semanticReplyText(response: string): string {
  let current = response.trim();
  for (let depth = 0; depth < 4; depth += 1) {
    const unfenced = current.replace(/^```json\s*/u, "").replace(/\s*```$/u, "");
    try {
      const parsed = JSON.parse(unfenced) as unknown;
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
    } catch {
      return current;
    }
    return current;
  }
  return current;
}

function expectRelationshipStatement(
  response: string,
  names: readonly string[],
  relationship: RegExp,
): void {
  const relevantSectionExists = names.some((anchor) => {
    let anchorIndex = response.indexOf(anchor);
    while (anchorIndex >= 0) {
      const section = response.slice(Math.max(0, anchorIndex - 160), anchorIndex + 480);
      if (names.every((name) => section.includes(name)) && relationship.test(section)) return true;
      anchorIndex = response.indexOf(anchor, anchorIndex + anchor.length);
    }
    return false;
  });
  expect(relevantSectionExists, response).toBe(true);
}

describe.runIf(runEvaluation)("Traditional Chinese continuity Vertex evaluation", () => {
  it("evaluates sparse family-graph inference without persisting derived edges", async () => {
    if (configuration === null) throw new Error("Vertex configuration is required for this evaluation.");
    const persistence = new InMemoryPersistence();
    const responses: string[] = [];
    const liveResponder = new ConversationResponder(
      new CommittedSourceCardGrounding([]),
      new VertexConversationProvider(new VertexRestClient(configuration)),
      60_000,
    );

    const cleanup = await runSyntheticContinuityVerification({
      continuity: new InMemoryContinuityRepository(),
      messages: persistence.messages,
      familyMaps: persistence.familyMaps,
      receipts: persistence.externalEvents,
    }, {
      fixtureUrl: SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
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
    const rawFinalResponse = responses.at(-1)!;
    const finalResponse = semanticReplyText(rawFinalResponse);
    for (const name of ["銀之介", "野原鶴", "廣志", "美冴", "小新", "小葵"]) {
      expect(finalResponse).toContain(name);
    }
    expectRelationshipStatement(finalResponse, ["銀之介", "廣志"], /父子|父親|爸爸|兒子|之父|之子/u);
    expectRelationshipStatement(finalResponse, ["野原鶴", "美冴"], /婆媳|婆婆|媳婦|兒媳|公公|姻親/u);
    expectRelationshipStatement(finalResponse, ["小新", "小葵"], /祖孫|祖父母|爺爺奶奶|孫/u);
    expect(finalResponse).toMatch(/直接/u);
    expect(finalResponse).toMatch(/推論|推得|間接/u);
    const primaryWorkspace = WorkspaceIdSchema.parse(cleanup.workspaceIds[0]);
    await expect(persistence.familyMaps.get(primaryWorkspace)).resolves.toMatchObject({
      content: "",
      revision: 0,
    });
  }, 240_000);
});
