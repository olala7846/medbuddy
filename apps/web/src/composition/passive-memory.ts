import { DynamicMemoryService } from "@medbuddy/chat";
import {
  PASSIVE_MEMORY_MAX_ATTEMPTS,
  PASSIVE_MEMORY_POLICY_VERSION,
  PassiveMemoryAttemptFenceSchema,
  PassiveMemoryGeneratorOutputSchema,
  PassiveMemoryJobSchema,
  PassiveMemoryTaskInputSchema,
  ProposeMemoryInputSchema,
  containsFamilyRelationshipTerm,
  type PassiveMemoryEvidence,
  type PassiveMemoryProposal,
  type PassiveMemoryEvidenceReader,
  type PassiveMemoryJob,
  type PassiveMemoryJobRepository,
  type PassiveMemoryTaskInput,
} from "@medbuddy/contracts";
import {
  PASSIVE_MEMORY_MODEL_ID,
  VertexPassiveMemoryGenerator,
  VertexRestClient,
  type PassiveStructuredGenerator,
} from "@medbuddy/intelligence";
import {
  GoogleTaskTokenVerifier,
  createPassiveMemoryPlatform,
  verifyTaskCallback,
  type TaskTokenVerifier,
} from "@medbuddy/platform";
import { z } from "zod";

export const PassiveMemoryWorkerLogEntrySchema = z.object({
  event: z.enum([
    "passive_memory_task_rejected",
    "passive_memory_job_started",
    "passive_memory_job_completed",
    "passive_memory_job_failed",
    "passive_memory_job_reused",
    "passive_memory_alert",
  ]),
  code: z.enum(["UNAUTHORIZED", "INVALID_BODY", "RETRYABLE", "EXHAUSTED", "CONTRACT_INVALID", "CONFLICT"]).optional(),
  attempt: z.number().int().min(0).max(PASSIVE_MEMORY_MAX_ATTEMPTS).optional(),
  evidenceCount: z.enum(["ZERO", "ONE", "TWO_TO_FOUR", "FIVE_TO_128"]).optional(),
  proposalCount: z.enum(["ZERO", "ONE", "TWO_TO_FOUR", "FIVE_TO_16"]).optional(),
  rangeSize: z.enum(["ONE", "TWO_TO_TEN", "ELEVEN_TO_100", "OVER_100"]).optional(),
  durationClass: z.enum(["UNDER_1S", "UNDER_5S", "UNDER_15S", "AT_LEAST_15S"]).optional(),
  policyVersion: z.literal(PASSIVE_MEMORY_POLICY_VERSION).optional(),
}).strict();

export type PassiveMemoryWorkerLogEntry = z.infer<typeof PassiveMemoryWorkerLogEntrySchema>;

export interface PassiveMemoryWorkerLogger {
  write(entry: PassiveMemoryWorkerLogEntry): void;
}

function withoutLease(job: PassiveMemoryJob) {
  const { attemptClaimedAt: _claimedAt, attemptLeaseExpiresAt: _expiresAt, ...released } = job;
  void _claimedAt;
  void _expiresAt;
  return released;
}

function fence(job: PassiveMemoryJob) {
  return PassiveMemoryAttemptFenceSchema.parse({ jobId: job.id, claimGeneration: job.claimGeneration });
}

function evidenceCountClass(count: number): NonNullable<PassiveMemoryWorkerLogEntry["evidenceCount"]> {
  if (count === 0) return "ZERO" as const;
  if (count === 1) return "ONE" as const;
  if (count <= 4) return "TWO_TO_FOUR" as const;
  return "FIVE_TO_128";
}

function proposalCountClass(count: number): NonNullable<PassiveMemoryWorkerLogEntry["proposalCount"]> {
  if (count === 0) return "ZERO";
  if (count === 1) return "ONE";
  if (count <= 4) return "TWO_TO_FOUR";
  return "FIVE_TO_16";
}

function rangeSizeClass(size: number): PassiveMemoryWorkerLogEntry["rangeSize"] {
  if (size === 1) return "ONE";
  if (size <= 10) return "TWO_TO_TEN";
  if (size <= 100) return "ELEVEN_TO_100";
  return "OVER_100";
}

function durationClass(milliseconds: number): PassiveMemoryWorkerLogEntry["durationClass"] {
  if (milliseconds < 1_000) return "UNDER_1S";
  if (milliseconds < 5_000) return "UNDER_5S";
  if (milliseconds < 15_000) return "UNDER_15S";
  return "AT_LEAST_15S";
}

function proposedText(proposal: PassiveMemoryProposal): string {
  switch (proposal.payload.memoryType) {
    case "SEMANTIC": return proposal.payload.statement;
    case "EPISODIC": return proposal.payload.event;
    case "PROCEDURAL": return proposal.payload.preference;
  }
}

function normalizedSpan(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function isGovernedAffirmativeEvidence(evidence: PassiveMemoryEvidence, proposal: PassiveMemoryProposal): boolean {
  const body = evidence.effectiveText.normalize("NFKC");
  if (/[?？]/u.test(body) || /\bwhether\b|^(?:who|what|when|where|why|how|do|does|did|is|are|can|could|should)\b|(?:是否|是不是|嗎|呢)[。！!]?$/iu.test(body)) return false;
  if (/\b(?:maybe|might|perhaps|probably|unsure|uncertain|not sure|i think|i guess|seems?|appears?|if|would|could|according to)\b|(?:可能|也許|或許|大概|不確定|好像|似乎|如果|假如|我想知道|根據.+(?:說法|表示))/iu.test(body)) return false;
  if (/\b(?:no|not|never|without|don['’]?t|didn['’]?t|isn['’]?t|wasn['’]?t|won['’]?t)\b|(?:沒有|沒|不是|不會|未曾|尚未)/iu.test(body)) return false;
  if (/["“”「」『』]/u.test(body) || /\b(?:said|says|told|quoted)\b|(?:轉述|聽說|表示|說道)/iu.test(body)) return false;
  if (containsFamilyRelationshipTerm(body)) return false;
  const trimmed = body.trim();
  const captured = proposal.payload.memoryType === "PROCEDURAL"
    ? (/^(?:(?:please\s+)?(?:use|keep|make)\b|(?:i|we)\s+(?:prefer|want):|請(?:用|使用|保持)|我(?:們)?(?:偏好|希望|想要)[：:])/iu.test(trimmed) ? trimmed : null)
    : (/^(?:i|we)\s+confirm:\s*(.+)$/iu.exec(trimmed)?.[1]
      ?? /^我(?:們)?確認[：:]\s*(.+)$/u.exec(trimmed)?.[1]
      ?? null);
  if (captured === null) return false;
  const source = normalizedSpan(captured);
  return [proposedText(proposal), ...proposal.payload.subjectLabels, ...proposal.tags]
    .every((value) => source.includes(normalizedSpan(value)));
}

class PassiveProposalPolicyError extends Error {}

/** One silent attempt over one persisted, leased source range. */
export class PassiveMemoryWorker {
  constructor(private readonly dependencies: {
    jobs: PassiveMemoryJobRepository;
    evidence: PassiveMemoryEvidenceReader;
    generator: PassiveStructuredGenerator;
    memory: DynamicMemoryService;
    now: () => string;
    clock?: () => number;
    logger: PassiveMemoryWorkerLogger;
  }) {}

  async run(input: PassiveMemoryTaskInput): Promise<"COMPLETED" | "REUSED" | "EXHAUSTED"> {
    const persisted = await this.dependencies.jobs.get(input.workspaceId, input.jobId);
    if (persisted === null || persisted.workspaceId !== input.workspaceId || persisted.id !== input.jobId) {
      throw new Error("Passive-memory task does not match a persisted workspace job.");
    }
    const claim = await this.dependencies.jobs.claimAttempt(input.workspaceId, input.jobId, this.dependencies.now());
    if (claim.kind === "BUSY") {
      this.dependencies.logger.write({ event: "passive_memory_job_reused", attempt: claim.job.attempts });
      return "REUSED";
    }
    if (claim.kind === "TERMINAL") return claim.job.status === "COMPLETED" ? "COMPLETED" : "EXHAUSTED";

    const job = claim.job;
    const attemptFence = fence(job);
    const startedAt = this.dependencies.clock?.() ?? Date.now();
    const rangeSize = job.lastSourceSequence - job.firstSourceSequence + 1;
    try {
      const evidence = await this.dependencies.evidence.readEffectiveHumanText({
        workspaceId: job.workspaceId,
        firstSourceSequence: job.firstSourceSequence,
        lastSourceSequence: job.lastSourceSequence,
      });
      this.dependencies.logger.write({
        event: "passive_memory_job_started",
        attempt: job.attempts,
        evidenceCount: evidenceCountClass(evidence.evidence.length),
        rangeSize: rangeSizeClass(rangeSize),
        policyVersion: PASSIVE_MEMORY_POLICY_VERSION,
      });
      const generated = await this.dependencies.generator.generate(evidence);
      const output = PassiveMemoryGeneratorOutputSchema.parse(generated.output);
      const bySource = new Map(evidence.evidence.map((item) => [item.canonicalSourceRef, item]));
      const canonical = output.proposals.map((proposal) => ({
        proposal,
        key: `${proposal.sourceRef}\u0000${JSON.stringify(proposal.payload)}\u0000${JSON.stringify([...proposal.tags].sort())}`,
      })).sort((left, right) => left.key.localeCompare(right.key));
      if (new Set(canonical.map(({ key }) => key)).size !== canonical.length) {
        throw new PassiveProposalPolicyError("Duplicate passive proposals are not a canonical batch.");
      }
      const slots = new Map<string, number>();
      const records = [];
      for (const { proposal } of canonical) {
        const source = bySource.get(proposal.sourceRef);
        if (source === undefined || !isGovernedAffirmativeEvidence(source, proposal)) {
          throw new PassiveProposalPolicyError("Passive proposal is not bound to eligible claimed evidence.");
        }
        const proposalSlot = slots.get(source.canonicalSourceRef) ?? 0;
        slots.set(source.canonicalSourceRef, proposalSlot + 1);
        const result = this.dependencies.memory.materializePassive({
          workspaceId: job.workspaceId,
          evidence: source,
          proposalSlot,
        }, ProposeMemoryInputSchema.parse({ payload: proposal.payload, tags: proposal.tags }));
        if (result.kind !== "MATERIALIZED") {
          throw new PassiveProposalPolicyError("Passive proposal failed governed memory validation.");
        }
        records.push(result.record);
      }
      await this.dependencies.jobs.finish(PassiveMemoryJobSchema.parse({
        ...withoutLease(job),
        status: "COMPLETED",
      }), attemptFence, records);
      this.dependencies.logger.write({
        event: "passive_memory_job_completed",
        attempt: job.attempts,
        proposalCount: proposalCountClass(output.proposals.length),
        durationClass: durationClass((this.dependencies.clock?.() ?? Date.now()) - startedAt),
        policyVersion: PASSIVE_MEMORY_POLICY_VERSION,
      });
      return "COMPLETED";
    } catch (error) {
      const exhausted = job.attempts >= PASSIVE_MEMORY_MAX_ATTEMPTS;
      const next = PassiveMemoryJobSchema.parse({
        ...withoutLease(job),
        status: exhausted ? "FAILED" : "PENDING",
      });
      if (exhausted) await this.dependencies.jobs.finish(next, attemptFence);
      else await this.dependencies.jobs.releaseAttempt(next, attemptFence);
      const code = error instanceof PassiveProposalPolicyError || error instanceof z.ZodError
          ? "CONTRACT_INVALID"
          : exhausted ? "EXHAUSTED" : "RETRYABLE";
      this.dependencies.logger.write({
        event: "passive_memory_job_failed",
        code,
        attempt: job.attempts,
        rangeSize: rangeSizeClass(rangeSize),
        durationClass: durationClass((this.dependencies.clock?.() ?? Date.now()) - startedAt),
        policyVersion: PASSIVE_MEMORY_POLICY_VERSION,
      });
      if (exhausted) {
        this.dependencies.logger.write({
          event: "passive_memory_alert",
          code: "EXHAUSTED",
          attempt: job.attempts,
          rangeSize: rangeSizeClass(rangeSize),
          policyVersion: PASSIVE_MEMORY_POLICY_VERSION,
        });
        return "EXHAUSTED";
      }
      throw error;
    }
  }
}

export class PassiveMemoryTaskHandler {
  constructor(private readonly dependencies: {
    audience: string;
    serviceAccountEmail: string;
    verifier: TaskTokenVerifier;
    worker: PassiveMemoryWorker;
    logger: PassiveMemoryWorkerLogger;
  }) {}

  async authorize(authorization: string | undefined): Promise<boolean> {
    try {
      await verifyTaskCallback({
        authorization,
        audience: this.dependencies.audience,
        serviceAccountEmail: this.dependencies.serviceAccountEmail,
        verifier: this.dependencies.verifier,
      });
      return true;
    } catch {
      this.dependencies.logger.write({ event: "passive_memory_task_rejected", code: "UNAUTHORIZED" });
      return false;
    }
  }

  async handleAuthenticated(bodyValue: unknown): Promise<{ status: 200 | 400 | 500 }> {
    let body = bodyValue;
    if (typeof body === "string") {
      try { body = JSON.parse(body) as unknown; } catch { body = undefined; }
    }
    const parsed = PassiveMemoryTaskInputSchema.safeParse(body);
    if (!parsed.success) {
      this.dependencies.logger.write({ event: "passive_memory_task_rejected", code: "INVALID_BODY" });
      return { status: 400 };
    }
    try {
      await this.dependencies.worker.run(parsed.data);
      return { status: 200 };
    } catch {
      return { status: 500 };
    }
  }

  async handle(input: { authorization: string | undefined; body: unknown }): Promise<{ status: 200 | 400 | 401 | 500 }> {
    if (!await this.authorize(input.authorization)) return { status: 401 };
    return this.handleAuthenticated(input.body);
  }
}

function requiredEnvironmentValue(environment: Record<string, string | undefined>, key: string): string {
  const value = environment[key]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Passive-memory configuration is missing ${key}.`);
  return value;
}

export function createPassiveMemoryTaskComposition(
  environment: Record<string, string | undefined>,
  logger: PassiveMemoryWorkerLogger,
): PassiveMemoryTaskHandler {
  if (environment.MEDBUDDY_VERTEX_ENABLED !== "true") {
    throw new Error("Passive-memory configuration requires explicitly enabled Vertex.");
  }
  const projectId = requiredEnvironmentValue(environment, "MEDBUDDY_GCP_PROJECT_ID");
  const audience = requiredEnvironmentValue(environment, "MEDBUDDY_PASSIVE_MEMORY_CALLBACK_URL");
  const serviceAccountEmail = requiredEnvironmentValue(environment, "MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL");
  const vertexProject = requiredEnvironmentValue(environment, "MEDBUDDY_VERTEX_PROJECT");
  const vertexLocation = requiredEnvironmentValue(environment, "MEDBUDDY_VERTEX_LOCATION");
  const platform = createPassiveMemoryPlatform(projectId);
  return new PassiveMemoryTaskHandler({
    audience,
    serviceAccountEmail,
    verifier: new GoogleTaskTokenVerifier(),
    worker: new PassiveMemoryWorker({
      jobs: platform.jobs,
      evidence: platform.evidence,
      generator: new VertexPassiveMemoryGenerator(new VertexRestClient({
        projectId: vertexProject,
        location: vertexLocation,
        model: PASSIVE_MEMORY_MODEL_ID,
      })),
      memory: new DynamicMemoryService(platform.memory),
      now: () => new Date().toISOString(),
      logger,
    }),
    logger,
  });
}

let passiveTaskHandler: PassiveMemoryTaskHandler | undefined;
const productionPassiveMemoryLogger: PassiveMemoryWorkerLogger = {
  write(entry) {
    console.info(JSON.stringify(PassiveMemoryWorkerLogEntrySchema.parse(entry)));
  },
};

export function getPassiveMemoryTaskHandler(): PassiveMemoryTaskHandler {
  passiveTaskHandler ??= createPassiveMemoryTaskComposition(process.env, productionPassiveMemoryLogger);
  return passiveTaskHandler;
}
