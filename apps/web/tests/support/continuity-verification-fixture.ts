import { readFile } from "node:fs/promises";
import { z } from "zod";

const StepIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const MentionSchema = z.object({
  mentionees: z.array(z.object({
    type: z.literal("user"),
    isSelf: z.literal(true),
  }).strict()).min(1).max(1),
}).strict();
const LineMessageEventSchema = z.object({
  type: z.literal("message"),
  mode: z.literal("active"),
  timestamp: z.number().int().nonnegative(),
  webhookEventId: z.string().min(1).max(256),
  replyToken: z.string().min(1).max(256),
  source: z.object({
    type: z.literal("group"),
    groupId: z.string().min(1).max(256),
    userId: z.string().min(1).max(256),
  }).strict(),
  message: z.object({
    id: z.string().min(1).max(256),
    type: z.literal("text"),
    text: z.string().min(1).max(100_000),
    mention: MentionSchema.optional(),
  }).strict(),
}).strict();
const SyntheticContinuityStepSchema = z.discriminatedUnion("action", [
  z.object({
    step: StepIdSchema,
    action: z.literal("SEND"),
    event: LineMessageEventSchema,
  }).strict(),
  z.object({
    step: StepIdSchema,
    action: z.literal("REPLAY_CONCURRENT"),
    targetStep: StepIdSchema,
    copies: z.literal(2),
  }).strict(),
  z.object({
    step: StepIdSchema,
    action: z.literal("DRAIN"),
  }).strict(),
]);

export type SyntheticContinuityStep = z.infer<typeof SyntheticContinuityStepSchema>;
export type SyntheticContinuitySendStep = Extract<SyntheticContinuityStep, { action: "SEND" }>;

export const SYNTHETIC_CONTINUITY_FIXTURE_URL = new URL(
  "../fixtures/continuity-verification.jsonl",
  import.meta.url,
);

export const SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL = new URL(
  "../fixtures/continuity-verification-zh-TW.jsonl",
  import.meta.url,
);

export const SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL = new URL(
  "../fixtures/deployed-memory-smoke.jsonl",
  import.meta.url,
);

export const TRADITIONAL_CHINESE_COMPACTED_CONTENT = {
  sourceText: "第一次回診，今天由我陪爸爸看診",
  summaryMarker: "第一次回診已納入虛構壓縮摘要",
} as const;

export const TRADITIONAL_CHINESE_RECENT_CONTENT = [
  "更正後是 125/78",
  "第二次回診，今天由我陪公公看診",
  "再量一週早晚血壓",
  "如果睡不好持續兩週",
  "下一次例行追蹤是四週後",
  "9 月 8 日早上 7:10",
  "下午散步也沒有",
  "昨晚大約十點半睡著",
] as const;

export const TRADITIONAL_CHINESE_CORRECTION = {
  originalSourceText: "我照著紙本先登記：9 月 5 日早上 7:30 的血壓是 152/88",
  correctedSourceText: "更正後是 125/78，脈搏 71；前面的 152/88 不採用",
} as const;

export function parseSyntheticContinuityJsonl(raw: string, runNonce: string): SyntheticContinuityStep[] {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runNonce)) throw new Error("Synthetic fixture run nonce is invalid.");
  const placeholders = raw.match(/\{\{[^{}]+\}\}/g) ?? [];
  if (placeholders.some((placeholder) => placeholder !== "{{RUN_NONCE}}") ||
      raw.replaceAll("{{RUN_NONCE}}", "").includes("{{")) {
    throw new Error("Synthetic fixture contains an unsupported placeholder.");
  }
  const substituted = raw.replaceAll("{{RUN_NONCE}}", runNonce);
  const lines = substituted.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("Synthetic fixture is empty.");
  const steps = lines.map((line, index) => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Synthetic fixture line ${index + 1} is not valid JSON.`);
    }
    return SyntheticContinuityStepSchema.parse(decoded);
  });
  const seenSteps = new Set<string>();
  const sentSteps = new Set<string>();
  const replayTargets = new Set<string>();
  for (const step of steps) {
    if (seenSteps.has(step.step)) throw new Error(`Synthetic fixture has duplicate step ${step.step}.`);
    seenSteps.add(step.step);
    if (step.action === "SEND") sentSteps.add(step.step);
    if (step.action === "REPLAY_CONCURRENT") {
      if (!sentSteps.has(step.targetStep)) throw new Error("Synthetic fixture replay must reference an earlier SEND step.");
      if (replayTargets.has(step.targetStep)) throw new Error("Synthetic fixture has a duplicate step reference.");
      replayTargets.add(step.targetStep);
    }
  }
  return steps;
}

export async function loadSyntheticContinuityFixture(
  fixtureUrl: URL,
  runNonce: string,
): Promise<SyntheticContinuityStep[]> {
  return parseSyntheticContinuityJsonl(await readFile(fixtureUrl, "utf8"), runNonce);
}
