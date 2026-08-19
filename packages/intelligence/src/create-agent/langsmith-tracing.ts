import type { Callbacks } from "@langchain/core/callbacks/manager";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { Client } from "langsmith";
import { z } from "zod";

import { createContentSafeLangSmithFetch } from "../adapters/langsmith-vertex.js";
import type {
  MedBuddyAgentTraceRuntime,
  MedBuddyAgentTraceScope,
  MedBuddyAgentTraceSession,
} from "./runner.js";

const VerificationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

export const LangSmithMedBuddyAgentTraceConfigurationSchema = z.object({
  serviceKey: z.string().trim().min(1),
  project: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/),
  langSmithWorkspaceId: z.string().trim().min(1).max(256),
  apiUrl: z.enum([
    "https://api.smith.langchain.com",
    "https://eu.api.smith.langchain.com",
    "https://apac.api.smith.langchain.com",
    "https://aws.api.smith.langchain.com",
  ]),
  allowedAppWorkspaceId: z.string().regex(/^workspace:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  verificationId: VerificationIdSchema,
  modelId: z.string().trim().min(1).max(128),
  actualRevision: z.string().trim().min(1).max(128),
  allowedIsolatedRevision: z.string().trim().min(1).max(128),
}).strict();

export type LangSmithMedBuddyAgentTraceConfiguration = z.infer<
  typeof LangSmithMedBuddyAgentTraceConfigurationSchema
>;

const prohibitedTrueKeys = [
  "LANGSMITH_TRACING",
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING",
  "LANGCHAIN_TRACING_V2",
  "LANGSMITH_HIDE_INPUTS",
  "LANGSMITH_HIDE_OUTPUTS",
  "LANGCHAIN_VERBOSE",
] as const;

const prohibitedNonEmptyKeys = [
  "LANGSMITH_FAILED_TRACES_DIR",
  "LANGCHAIN_FAILED_TRACES_DIR",
] as const;

export function createMedBuddyAgentFictionalTraceMarker(verificationId: string): string {
  const parsed = VerificationIdSchema.safeParse(verificationId);
  if (!parsed.success) throw new Error("MedBuddy trace verification identifier is invalid.");
  return `[fictional-langsmith:${parsed.data}]`;
}

/** Selective callback runtime for one explicitly marked fictional invocation. */
export class LangSmithMedBuddyAgentTraceRuntime implements MedBuddyAgentTraceRuntime {
  private readonly configuration: LangSmithMedBuddyAgentTraceConfiguration;

  constructor(
    configuration: LangSmithMedBuddyAgentTraceConfiguration,
    environment: Record<string, string | undefined> = process.env,
    private readonly request: typeof fetch = fetch,
  ) {
    this.configuration = LangSmithMedBuddyAgentTraceConfigurationSchema.parse(configuration);
    if (this.configuration.actualRevision !== this.configuration.allowedIsolatedRevision) {
      throw new Error("MedBuddy agent tracing is not running on its isolated revision.");
    }
    const environments = environment === process.env
      ? [environment]
      : [environment, process.env];
    const automaticOrHidden = environments.some((source) => prohibitedTrueKeys.some((key) => {
      const value = source[key];
      return value !== undefined && value !== "false";
    }));
    const fallbackPersistence = environments.some((source) =>
      prohibitedNonEmptyKeys.some((key) => Boolean(source[key]?.trim()))
    );
    if (automaticOrHidden || fallbackPersistence) {
      throw new Error("MedBuddy exact-content agent tracing configuration is unsafe.");
    }
  }

  open(scope: MedBuddyAgentTraceScope): MedBuddyAgentTraceSession | null {
    const marker = createMedBuddyAgentFictionalTraceMarker(this.configuration.verificationId);
    if (
      scope.workspaceId !== this.configuration.allowedAppWorkspaceId
      || !scope.focalMessageBody.startsWith(`${marker}\n`)
    ) return null;

    let transportFailed = false;
    const attemptedOperations = new Set<"INFO" | "INGEST">();
    const transportController = new AbortController();
    const sessionRequest: typeof fetch = (input, init) => {
      const url = String(input);
      const operation = url.endsWith("/info")
        ? "INFO" as const
        : url.includes("/runs/multipart") || url.includes("/runs/batch")
          ? "INGEST" as const
          : null;
      if (operation === null || attemptedOperations.has(operation)) {
        transportFailed = true;
        throw new Error("AbortError: MedBuddy trace session rejected a transport retry.");
      }
      attemptedOperations.add(operation);
      const signal = init?.signal == null
        ? transportController.signal
        : AbortSignal.any([init.signal, transportController.signal]);
      return this.request(input, { ...init, signal });
    };
    const client = new Client({
      apiKey: this.configuration.serviceKey,
      apiUrl: this.configuration.apiUrl,
      workspaceId: this.configuration.langSmithWorkspaceId,
      manualFlushMode: true,
      timeout_ms: 2_000,
      callerOptions: { maxRetries: 0 },
      batchSizeBytesLimit: 5_000_000,
      batchSizeLimit: 100,
      tracingSamplingRate: 1,
      tracingMode: "langsmith",
      hideInputs: false,
      hideOutputs: false,
      hideMetadata: false,
      omitTracedRuntimeInfo: true,
      disablePromptCache: true,
      debug: false,
      fetchImplementation: createContentSafeLangSmithFetch(sessionRequest, () => {
        transportFailed = true;
      }),
    });
    const callbacks: Callbacks = [new LangChainTracer({
      client,
      projectName: this.configuration.project,
      replicas: [],
      metadata: {
        verificationId: this.configuration.verificationId,
        modelId: this.configuration.modelId,
        revision: this.configuration.actualRevision,
        contentMode: "fictional-only",
        contextContract: "medbuddy-create-agent-message-sequence-v1",
      },
      tags: ["fictional-only", "medbuddy-create-agent-prompt-review"],
    })];
    return {
      callbacks,
      flush: async () => {
        await client.flush();
        if (transportFailed) throw new Error("MedBuddy agent trace export failed.");
      },
      abort: () => transportController.abort(),
    };
  }
}
