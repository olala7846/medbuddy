import { Client } from "langsmith";
import { traceable, type TraceableFunction } from "langsmith/traceable";
import { z } from "zod";

import {
  buildVertexGenerateContentBody,
  type VertexGenerationRequest,
  type VertexInvocationContext,
  type VertexModelClient,
} from "./vertex.js";

export type VertexTraceBoundary = "conversation" | "compaction";

export type VertexTraceRecord = {
  requestBody: Record<string, unknown>;
  metadata: {
    boundary: VertexTraceBoundary;
    modelId: string;
    verificationId: string;
  };
};

export interface VertexTraceRuntime {
  run(trace: VertexTraceRecord, invoke: () => Promise<unknown>): Promise<unknown>;
  flush(): Promise<void>;
}

export const VertexTraceLogEntrySchema = z.object({
  event: z.literal("vertex_trace_failed"),
  boundary: z.enum(["conversation", "compaction"]),
  stage: z.enum(["TRACE", "FLUSH"]),
}).strict();

export type VertexTraceLogEntry = z.infer<typeof VertexTraceLogEntrySchema>;

export interface VertexTraceLogger {
  write(entry: VertexTraceLogEntry): void;
}

export type LangSmithRuntimeConfiguration = {
  serviceKey: string;
  project: string;
  workspaceId: string;
  apiUrl: string;
  boundary: VertexTraceBoundary;
  metadata: VertexTraceRecord["metadata"];
};

/** Exact-content trace transport used only by explicitly wrapped clients. */
export class LangSmithVertexTraceRuntime implements VertexTraceRuntime {
  private readonly client: Client;
  private readonly traced: TraceableFunction<(input: {
    requestBody: Record<string, unknown>;
    invoke: () => Promise<unknown>;
  }) => Promise<{ response: unknown }>>;

  constructor(configuration: LangSmithRuntimeConfiguration) {
    this.client = new Client({
      apiKey: configuration.serviceKey,
      apiUrl: configuration.apiUrl,
      workspaceId: configuration.workspaceId,
      manualFlushMode: true,
      tracingSamplingRate: 1,
      omitTracedRuntimeInfo: true,
      disablePromptCache: true,
      debug: false,
    });
    this.traced = traceable(
      async ({ invoke }) => ({ response: await invoke() }),
      {
        name: `medbuddy.vertex.${configuration.boundary}`,
        run_type: "llm",
        project_name: configuration.project,
        metadata: configuration.metadata,
        client: this.client,
        tracingEnabled: true,
        processInputs: ({ requestBody }) => ({ requestBody }),
      },
    );
  }

  async run(trace: VertexTraceRecord, invoke: () => Promise<unknown>): Promise<unknown> {
    return (await this.traced({ requestBody: trace.requestBody, invoke })).response;
  }

  async flush(): Promise<void> {
    await this.client.flush();
  }
}

type ProviderOutcome =
  | { kind: "SUCCEEDED"; value: unknown }
  | { kind: "FAILED"; error: unknown };

function containsInlineData(input: VertexGenerationRequest): boolean {
  return input.contents.some((content) =>
    content.parts.some((part) => Object.prototype.hasOwnProperty.call(part, "inlineData"))
  );
}

async function flushWithin(runtime: VertexTraceRuntime, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runtime.flush(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("TRACE_FLUSH_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Fail-open for the model call and fail-closed for export. The wrapper is
 * instantiated only for conversation or compaction; other Vertex clients stay
 * unwrapped.
 */
export class LangSmithVertexModelClient implements VertexModelClient {
  private readonly metadata: VertexTraceRecord["metadata"];

  constructor(private readonly options: {
    delegate: VertexModelClient;
    boundary: VertexTraceBoundary;
    allowedWorkspaceId: string;
    verificationId: string;
    modelId: string;
    runtime: VertexTraceRuntime;
    logger?: VertexTraceLogger;
    flushTimeoutMs?: number;
  }) {
    this.metadata = {
      boundary: options.boundary,
      modelId: options.modelId,
      verificationId: options.verificationId,
    };
  }

  async generate(input: VertexGenerationRequest, context?: VertexInvocationContext): Promise<unknown> {
    if (
      context?.workspaceId !== this.options.allowedWorkspaceId ||
      containsInlineData(input)
    ) {
      return this.options.delegate.generate(input, context);
    }

    let outcome: ProviderOutcome | undefined;
    let traceFailureLogged = false;
    try {
      await this.options.runtime.run({
        requestBody: buildVertexGenerateContentBody(input),
        metadata: this.metadata,
      }, async () => {
        try {
          const value = await this.options.delegate.generate(input, context);
          outcome = { kind: "SUCCEEDED", value };
          return value;
        } catch (error) {
          outcome = { kind: "FAILED", error };
          throw error;
        }
      });
    } catch {
      if (outcome?.kind !== "FAILED") {
        this.logFailure("TRACE");
        traceFailureLogged = true;
      }
    } finally {
      try {
        await flushWithin(this.options.runtime, this.options.flushTimeoutMs ?? 2_000);
      } catch {
        this.logFailure("FLUSH");
      }
    }

    if (outcome === undefined) {
      if (!traceFailureLogged) this.logFailure("TRACE");
      return this.options.delegate.generate(input, context);
    }
    if (outcome.kind === "FAILED") throw outcome.error;
    return outcome.value;
  }

  private logFailure(stage: VertexTraceLogEntry["stage"]): void {
    this.options.logger?.write(VertexTraceLogEntrySchema.parse({
      event: "vertex_trace_failed",
      boundary: this.options.boundary,
      stage,
    }));
  }
}
