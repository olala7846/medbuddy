import {
  createReadySegment,
  projectEffectiveConversation,
  renderProjectedTurn,
  type CompactionPlan,
} from "@medbuddy/chat";
import {
  COMPACTION_MAX_ATTEMPTS,
  CompactionJobSchema,
  ContinuityTaskInputSchema,
  type ContinuityRepository,
  type ContinuityTaskInput,
} from "@medbuddy/contracts";
import { verifyTaskCallback, type TaskTokenVerifier } from "@medbuddy/platform";
import { createConversationPlatform, GoogleTaskTokenVerifier } from "@medbuddy/platform";
import {
  CompactionSummaryGenerator,
  type GeneratedCompactionSummary,
  loadVertexConfiguration,
  VertexRestClient,
} from "@medbuddy/intelligence";
import { z } from "zod";

export const ContinuityWorkerLogEntrySchema = z.object({
  event: z.enum([
    "continuity_task_rejected",
    "continuity_job_started",
    "continuity_job_completed",
    "continuity_job_failed",
    "continuity_job_reused",
    "continuity_publication_conflict",
  ]),
  code: z.enum(["UNAUTHORIZED", "INVALID_BODY", "RETRYABLE", "EXHAUSTED"]).optional(),
  level: z.number().int().positive().max(32).optional(),
  attempt: z.number().int().min(0).max(COMPACTION_MAX_ATTEMPTS).optional(),
  inputCharacters: z.number().int().nonnegative().max(30_000).optional(),
  outputCharacters: z.number().int().nonnegative().max(4_000).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  durationClass: z.enum(["UNDER_1S", "UNDER_5S", "UNDER_15S", "AT_LEAST_15S"]).optional(),
  backlogClass: z.enum(["AT_MOST_10K", "AT_MOST_20K", "AT_MOST_30K", "OVER_30K"]).optional(),
  omissionCount: z.number().int().nonnegative().optional(),
  modelId: z.literal("gemini-3.6-flash").optional(),
  promptVersion: z.literal("continuity-summary-v1").optional(),
  policyVersion: z.literal("continuity-v1").optional(),
}).strict();

export type ContinuityWorkerLogEntry = z.infer<typeof ContinuityWorkerLogEntrySchema>;

export interface ContinuityWorkerLogger {
  write(entry: ContinuityWorkerLogEntry): void;
}

export interface CompactionSummaryPort {
  generate(input: {
    workspaceId: string;
    level: number;
    firstSourceSequence: number;
    lastSourceSequence: number;
    allowedSourceSequences: readonly number[];
    renderedInput: string;
  }): Promise<GeneratedCompactionSummary>;
}

function durationClass(milliseconds: number): ContinuityWorkerLogEntry["durationClass"] {
  if (milliseconds < 1_000) return "UNDER_1S";
  if (milliseconds < 5_000) return "UNDER_5S";
  if (milliseconds < 15_000) return "UNDER_15S";
  return "AT_LEAST_15S";
}

function backlogClass(characters: number): ContinuityWorkerLogEntry["backlogClass"] {
  if (characters <= 10_000) return "AT_MOST_10K";
  if (characters <= 20_000) return "AT_MOST_20K";
  if (characters <= 30_000) return "AT_MOST_30K";
  return "OVER_30K";
}

export class ContinuityCompactionWorker {
  constructor(private readonly dependencies: {
    continuity: ContinuityRepository;
    generator: CompactionSummaryPort;
    now: () => string;
    clock?: () => number;
    modelId: "gemini-3.6-flash";
    promptVersion: "continuity-summary-v1";
    logger: ContinuityWorkerLogger;
  }) {}

  async run(input: ContinuityTaskInput): Promise<"PUBLISHED" | "REUSED" | "EXHAUSTED"> {
    const active = await this.dependencies.continuity.getActiveCompactionJob(input.workspaceId);
    if (active === null || active.id !== input.jobId) {
      throw new Error("Continuity task does not match the active workspace job.");
    }
    const existing = (await this.dependencies.continuity.listReadySegments(input.workspaceId)).find((segment) =>
      segment.level === active.level &&
      segment.firstSourceSequence === active.firstSourceSequence &&
      segment.lastSourceSequence === active.lastSourceSequence &&
      segment.orderedSourceDigest === active.orderedSourceDigest);
    if (existing !== undefined) {
      await this.dependencies.continuity.publishSegment(existing);
      this.dependencies.logger.write({ event: "continuity_job_reused", level: active.level, attempt: active.attempts });
      return "REUSED";
    }
    if (active.attempts >= COMPACTION_MAX_ATTEMPTS) {
      await this.dependencies.continuity.updateCompactionJob(CompactionJobSchema.parse({ ...active, status: "FAILED" }));
      this.dependencies.logger.write({ event: "continuity_job_failed", code: "EXHAUSTED", level: active.level, attempt: active.attempts });
      return "EXHAUSTED";
    }

    const attempt = active.attempts + 1;
    await this.dependencies.continuity.updateCompactionJob(CompactionJobSchema.parse({
      ...active,
      status: "RUNNING",
      attempts: attempt,
    }));
    const startedAt = this.dependencies.clock?.() ?? Date.now();
    try {
      const sources = await this.dependencies.continuity.listSourceEvents(input.workspaceId);
      const rangeSources = sources.filter((event) =>
        event.sourceSequence >= active.firstSourceSequence && event.sourceSequence <= active.lastSourceSequence);
      const ready = await this.dependencies.continuity.listReadySegments(input.workspaceId);
      const children = active.childSegmentIds.map((childId) => {
        const child = ready.find((segment) => segment.id === childId);
        if (child === undefined) throw new Error("Higher-level compaction child is unavailable.");
        return child;
      });
      const projection = active.level === 1
        ? projectEffectiveConversation(input.workspaceId, rangeSources)
        : [];
      const renderedInput = active.level === 1
        ? projection.map(renderProjectedTurn).join("\n\n")
        : children.map((child) => JSON.stringify(child.summary)).join("\n\n");
      const plan: CompactionPlan = {
        id: active.id,
        workspaceId: active.workspaceId,
        level: active.level,
        firstSourceSequence: active.firstSourceSequence,
        lastSourceSequence: active.lastSourceSequence,
        sourceCount: active.level === 1
          ? rangeSources.length
          : children.reduce((total, child) => total + child.sourceCount, 0),
        orderedSourceDigest: active.orderedSourceDigest,
        childSegmentIds: active.childSegmentIds,
        policyVersion: active.policyVersion,
        inputCharacters: renderedInput.length,
      };
      this.dependencies.logger.write({
        event: "continuity_job_started",
        level: active.level,
        attempt,
        inputCharacters: renderedInput.length,
        backlogClass: backlogClass(renderedInput.length),
        modelId: this.dependencies.modelId,
        promptVersion: this.dependencies.promptVersion,
        ...(active.policyVersion === "continuity-v1" ? { policyVersion: active.policyVersion } : {}),
      });
      const generated = await this.dependencies.generator.generate({
        workspaceId: input.workspaceId,
        level: active.level,
        firstSourceSequence: active.firstSourceSequence,
        lastSourceSequence: active.lastSourceSequence,
        allowedSourceSequences: projection.map((turn) => turn.sourceSequence),
        renderedInput,
      });
      const segment = createReadySegment({
        plan,
        currentSources: rangeSources,
        summary: generated.summary,
        modelId: this.dependencies.modelId,
        promptVersion: this.dependencies.promptVersion,
        createdAt: this.dependencies.now(),
      });
      try {
        await this.dependencies.continuity.publishSegment(segment);
      } catch (error) {
        this.dependencies.logger.write({
          event: "continuity_publication_conflict",
          level: active.level,
          attempt,
        });
        throw error;
      }
      this.dependencies.logger.write({
        event: "continuity_job_completed",
        level: active.level,
        attempt,
        inputCharacters: segment.inputCharacters,
        outputCharacters: segment.outputCharacters,
        ...(generated.usage === undefined ? {} : generated.usage),
        durationClass: durationClass((this.dependencies.clock?.() ?? Date.now()) - startedAt),
        modelId: this.dependencies.modelId,
        promptVersion: this.dependencies.promptVersion,
        ...(active.policyVersion === "continuity-v1" ? { policyVersion: active.policyVersion } : {}),
      });
      return "PUBLISHED";
    } catch (error) {
      const exhausted = attempt >= COMPACTION_MAX_ATTEMPTS;
      await this.dependencies.continuity.updateCompactionJob(CompactionJobSchema.parse({
        ...active,
        attempts: attempt,
        status: exhausted ? "FAILED" : "PENDING",
      }));
      this.dependencies.logger.write({
        event: "continuity_job_failed",
        code: exhausted ? "EXHAUSTED" : "RETRYABLE",
        level: active.level,
        attempt,
        durationClass: durationClass((this.dependencies.clock?.() ?? Date.now()) - startedAt),
      });
      if (exhausted) return "EXHAUSTED";
      throw error;
    }
  }
}

export class ContinuityTaskHandler {
  constructor(private readonly dependencies: {
    audience: string;
    serviceAccountEmail: string;
    verifier: TaskTokenVerifier;
    worker: ContinuityCompactionWorker;
    logger: ContinuityWorkerLogger;
  }) {}

  async handle(input: { authorization: string | undefined; body: unknown }): Promise<{ status: 200 | 400 | 401 | 500 }> {
    try {
      await verifyTaskCallback({
        authorization: input.authorization,
        audience: this.dependencies.audience,
        serviceAccountEmail: this.dependencies.serviceAccountEmail,
        verifier: this.dependencies.verifier,
      });
    } catch {
      this.dependencies.logger.write({ event: "continuity_task_rejected", code: "UNAUTHORIZED" });
      return { status: 401 };
    }
    let body: unknown = input.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body) as unknown;
      } catch {
        body = undefined;
      }
    }
    const parsed = ContinuityTaskInputSchema.safeParse(body);
    if (!parsed.success) {
      this.dependencies.logger.write({ event: "continuity_task_rejected", code: "INVALID_BODY" });
      return { status: 400 };
    }
    try {
      await this.dependencies.worker.run(parsed.data);
      return { status: 200 };
    } catch {
      return { status: 500 };
    }
  }
}

function requiredEnvironmentValue(
  environment: Record<string, string | undefined>,
  key: string,
): string {
  const value = environment[key]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Continuity configuration is missing ${key}.`);
  return value;
}

export function createContinuityTaskComposition(
  environment: Record<string, string | undefined>,
  logger: ContinuityWorkerLogger,
): ContinuityTaskHandler {
  const projectId = requiredEnvironmentValue(environment, "MEDBUDDY_GCP_PROJECT_ID");
  const audience = requiredEnvironmentValue(environment, "MEDBUDDY_CONTINUITY_CALLBACK_URL");
  const serviceAccountEmail = requiredEnvironmentValue(environment, "MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL");
  const vertex = loadVertexConfiguration(environment);
  if (vertex === null || vertex.model !== "gemini-3.6-flash") {
    throw new Error("Continuity requires MEDBUDDY_VERTEX_MODEL=gemini-3.6-flash.");
  }
  const platform = createConversationPlatform(projectId);
  return new ContinuityTaskHandler({
    audience,
    serviceAccountEmail,
    verifier: new GoogleTaskTokenVerifier(),
    worker: new ContinuityCompactionWorker({
      continuity: platform.continuity,
      generator: new CompactionSummaryGenerator(new VertexRestClient(vertex)),
      now: () => new Date().toISOString(),
      modelId: vertex.model,
      promptVersion: "continuity-summary-v1",
      logger,
    }),
    logger,
  });
}

let taskHandler: ContinuityTaskHandler | undefined;
const productionContinuityLogger: ContinuityWorkerLogger = {
  write(entry) {
    console.info(JSON.stringify(ContinuityWorkerLogEntrySchema.parse(entry)));
  },
};

export function getContinuityTaskHandler(): ContinuityTaskHandler {
  taskHandler ??= createContinuityTaskComposition(process.env, productionContinuityLogger);
  return taskHandler;
}
