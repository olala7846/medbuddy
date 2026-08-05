import {
  LangSmithVertexModelClient,
  LangSmithVertexTraceRuntime,
  VertexTraceLogEntrySchema,
  type LangSmithRuntimeConfiguration,
  type VertexModelClient,
  type VertexTraceBoundary,
  type VertexTraceLogger,
  type VertexTraceRuntime,
} from "@medbuddy/intelligence";

import { loadLangSmithTracingConfiguration } from "./config.js";

type VertexTraceRuntimeFactory = (
  configuration: LangSmithRuntimeConfiguration,
) => VertexTraceRuntime;

export const productionVertexTraceLogger: VertexTraceLogger = {
  write(entry) {
    process.stdout.write(`${JSON.stringify(VertexTraceLogEntrySchema.parse(entry))}\n`);
  },
};

/** Applies exact-content tracing only when the MedBuddy-specific gate is complete. */
export function applyLangSmithVertexTracing(
  environment: Record<string, string | undefined>,
  options: {
    client: VertexModelClient;
    boundary: VertexTraceBoundary;
    modelId: string;
    logger?: VertexTraceLogger;
    runtimeFactory?: VertexTraceRuntimeFactory;
  },
): VertexModelClient {
  const tracing = loadLangSmithTracingConfiguration(environment);
  if (tracing === null) return options.client;
  const metadata = {
    boundary: options.boundary,
    modelId: options.modelId,
    verificationId: tracing.verificationId,
  } as const;
  const runtimeConfiguration: LangSmithRuntimeConfiguration = {
    serviceKey: tracing.serviceKey,
    project: tracing.project,
    workspaceId: tracing.langSmithWorkspaceId,
    apiUrl: tracing.apiUrl,
    boundary: options.boundary,
    metadata,
  };
  const runtime = options.runtimeFactory?.(runtimeConfiguration)
    ?? new LangSmithVertexTraceRuntime(runtimeConfiguration);
  return new LangSmithVertexModelClient({
    delegate: options.client,
    boundary: options.boundary,
    allowedWorkspaceId: tracing.allowedMedBuddyWorkspaceId,
    verificationId: tracing.verificationId,
    modelId: options.modelId,
    runtime,
    logger: options.logger ?? productionVertexTraceLogger,
  });
}
