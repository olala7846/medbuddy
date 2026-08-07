import { z } from "zod";

const SemanticScenarioSchema = z.object({
  memoryType: z.literal("SEMANTIC"),
  body: z.string().min(1),
  expected: z.object({
    memoryType: z.literal("SEMANTIC"),
    statement: z.string().min(1),
  }).strict(),
}).strict();

const EpisodicScenarioSchema = z.object({
  memoryType: z.literal("EPISODIC"),
  body: z.string().min(1),
  expected: z.object({
    memoryType: z.literal("EPISODIC"),
    event: z.string().min(1),
  }).strict(),
}).strict();

const ProceduralScenarioSchema = z.object({
  memoryType: z.literal("PROCEDURAL"),
  body: z.string().min(1),
  expected: z.object({
    memoryType: z.literal("PROCEDURAL"),
    preference: z.string().min(1),
    preferenceKind: z.enum(["LANGUAGE", "RESPONSE_LENGTH", "TONE", "FORMAT", "SUMMARY_STRUCTURE"]),
    appliesTo: z.enum(["ALL_RESPONSES", "SUMMARIES"]),
  }).strict(),
}).strict();

export const MemoryAcceptanceEvaluationScenarioSchema = z.discriminatedUnion("memoryType", [
  SemanticScenarioSchema,
  EpisodicScenarioSchema,
  ProceduralScenarioSchema,
]);

export type MemoryAcceptanceEvaluationScenario = z.infer<typeof MemoryAcceptanceEvaluationScenarioSchema>;

export function parseMemoryAcceptanceEvaluationScenarios(raw: string): readonly MemoryAcceptanceEvaluationScenario[] {
  return raw.trim().split("\n").map((line) =>
    MemoryAcceptanceEvaluationScenarioSchema.parse(JSON.parse(line) as unknown));
}
