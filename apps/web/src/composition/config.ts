import { z } from "zod";
import {
  CONTINUITY_POLICIES,
  ContinuityProfileSchema,
  type ContinuityPolicy,
} from "@medbuddy/contracts";
import { COMPACTION_MODEL_ID } from "@medbuddy/intelligence";

const LocatorKeySchema = z.string().refine((value) => {
  const decoded = Buffer.from(value, "base64");
  return decoded.byteLength === 32 && decoded.toString("base64") === value;
}, "Attachment locator key must be canonical base64 for exactly 32 bytes.");

const RequiredProductionConfigSchema = z.object({
  MEDBUDDY_GCP_PROJECT_ID: z.string().trim().min(1),
  MEDBUDDY_TASKS_LOCATION: z.string().trim().min(1),
  MEDBUDDY_TASKS_QUEUE: z.string().trim().min(1),
  MEDBUDDY_CAPTURE_CALLBACK_URL: z.string().url(),
  MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  MEDBUDDY_ATTACHMENT_BUCKET: z.string().trim().min(3),
});

const RequiredContinuityConfigSchema = z.object({
  MEDBUDDY_GCP_PROJECT_ID: z.string().trim().min(1),
  MEDBUDDY_TASKS_LOCATION: z.string().trim().min(1),
  MEDBUDDY_TASKS_QUEUE: z.string().trim().min(1),
  MEDBUDDY_CONTINUITY_CALLBACK_URL: z.string().url(),
  MEDBUDDY_MEMORY_FORMATION_CALLBACK_URL: z.string().url(),
  MEDBUDDY_PASSIVE_MEMORY_CALLBACK_URL: z.string().url(),
  MEDBUDDY_ATTACHMENT_CALLBACK_URL: z.string().url(),
  MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  MEDBUDDY_ATTACHMENT_BUCKET: z.string().trim().min(3),
  MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  MEDBUDDY_ATTACHMENT_LOCATOR_KEY: LocatorKeySchema,
  MEDBUDDY_VERTEX_ENABLED: z.literal("true"),
  MEDBUDDY_VERTEX_PROJECT: z.string().trim().min(1),
  MEDBUDDY_VERTEX_LOCATION: z.string().trim().min(1),
  MEDBUDDY_VERTEX_MODEL: z.literal("gemini-3.6-flash"),
  MEDBUDDY_COMPACTION_VERTEX_MODEL: z.literal(COMPACTION_MODEL_ID).default(COMPACTION_MODEL_ID),
  MEDBUDDY_CONTINUITY_PROFILE: ContinuityProfileSchema.default("production"),
});

export type ProductionConfig = {
  projectId: string;
  tasksLocation: string;
  tasksQueue: string;
  captureCallbackUrl: string;
  taskServiceAccountEmail: string;
  attachmentBucket: string;
};

export type ContinuityConfiguration = {
  projectId: string;
  tasksLocation: string;
  tasksQueue: string;
  continuityCallbackUrl: string;
  memoryFormationCallbackUrl: string;
  passiveMemoryCallbackUrl: string;
  attachmentCallbackUrl: string;
  taskServiceAccountEmail: string;
  attachmentBucket: string;
  attachmentLocatorKeyVersion: string;
  attachmentLocatorKeyBase64: string;
  vertexProjectId: string;
  vertexLocation: string;
  vertexModel: "gemini-3.6-flash";
  compactionVertexModel: typeof COMPACTION_MODEL_ID;
  continuityPolicy: ContinuityPolicy;
};

const RequiredLineConfigSchema = z.object({
  MEDBUDDY_GCP_PROJECT_ID: z.string().trim().min(1),
  MEDBUDDY_LINE_CHANNEL_SECRET: z.string().min(1),
  MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
});

const LangSmithTracingConfigSchema = z.object({
  MEDBUDDY_LANGSMITH_TRACING_ENABLED: z.literal("true"),
  MEDBUDDY_LANGSMITH_SERVICE_KEY: z.string().trim().min(1),
  MEDBUDDY_LANGSMITH_PROJECT: z.string().trim().min(1),
  MEDBUDDY_LANGSMITH_WORKSPACE_ID: z.string().trim().min(1),
  MEDBUDDY_LANGSMITH_API_URL: z.enum([
    "https://api.smith.langchain.com",
    "https://eu.api.smith.langchain.com",
    "https://apac.api.smith.langchain.com",
    "https://aws.api.smith.langchain.com",
  ]),
  MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID: z.string().regex(/^workspace:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
  MEDBUDDY_LANGSMITH_VERIFICATION_ID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
});

export type LangSmithTracingConfiguration = {
  serviceKey: string;
  project: string;
  langSmithWorkspaceId: string;
  apiUrl: z.infer<typeof LangSmithTracingConfigSchema>["MEDBUDDY_LANGSMITH_API_URL"];
  allowedMedBuddyWorkspaceId: string;
  verificationId: string;
};

export type LineConfiguration = {
  projectId: string;
  channelSecret: string;
  channelAccessToken: string;
};

/** Safe startup error: it names missing keys but never echoes values or secrets. */
export class ProductionConfigurationError extends Error {
  constructor(readonly missingKeys: readonly string[]) {
    super(`Production configuration is incomplete: ${missingKeys.join(", ")}.`);
  }
}

export class LineConfigurationError extends Error {
  constructor(readonly missingKeys: readonly string[]) {
    super(`LINE configuration is incomplete: ${missingKeys.join(", ")}.`);
  }
}

export function loadLineConfiguration(
  environment: Record<string, string | undefined>,
): LineConfiguration {
  const parsed = RequiredLineConfigSchema.safeParse(environment);
  if (!parsed.success) {
    const missingKeys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new LineConfigurationError(missingKeys);
  }
  return {
    projectId: parsed.data.MEDBUDDY_GCP_PROJECT_ID,
    channelSecret: parsed.data.MEDBUDDY_LINE_CHANNEL_SECRET,
    channelAccessToken: parsed.data.MEDBUDDY_LINE_CHANNEL_ACCESS_TOKEN,
  };
}

/** Default-off exact-content tracing for one explicitly fictional workspace. */
export function loadLangSmithTracingConfiguration(
  environment: Record<string, string | undefined>,
): LangSmithTracingConfiguration | null {
  if (environment.MEDBUDDY_LANGSMITH_TRACING_ENABLED !== "true") return null;
  const parsed = LangSmithTracingConfigSchema.safeParse(environment);
  if (!parsed.success) {
    const missingKeys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ProductionConfigurationError(missingKeys);
  }
  const value = parsed.data;
  return {
    serviceKey: value.MEDBUDDY_LANGSMITH_SERVICE_KEY,
    project: value.MEDBUDDY_LANGSMITH_PROJECT,
    langSmithWorkspaceId: value.MEDBUDDY_LANGSMITH_WORKSPACE_ID,
    apiUrl: value.MEDBUDDY_LANGSMITH_API_URL,
    allowedMedBuddyWorkspaceId: value.MEDBUDDY_LANGSMITH_ALLOWED_WORKSPACE_ID,
    verificationId: value.MEDBUDDY_LANGSMITH_VERIFICATION_ID,
  };
}

export function loadProductionConfig(environment: Record<string, string | undefined>): ProductionConfig {
  const parsed = RequiredProductionConfigSchema.safeParse(environment);
  if (!parsed.success) {
    const missingKeys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ProductionConfigurationError(missingKeys);
  }
  const value = parsed.data;
  return {
    projectId: value.MEDBUDDY_GCP_PROJECT_ID,
    tasksLocation: value.MEDBUDDY_TASKS_LOCATION,
    tasksQueue: value.MEDBUDDY_TASKS_QUEUE,
    captureCallbackUrl: value.MEDBUDDY_CAPTURE_CALLBACK_URL,
    taskServiceAccountEmail: value.MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL,
    attachmentBucket: value.MEDBUDDY_ATTACHMENT_BUCKET,
  };
}

/** Validates the complete private continuity runtime without echoing any value. */
export function loadContinuityConfiguration(
  environment: Record<string, string | undefined>,
): ContinuityConfiguration {
  const parsed = RequiredContinuityConfigSchema.safeParse(environment);
  if (!parsed.success) {
    const missingKeys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ProductionConfigurationError(missingKeys);
  }
  const value = parsed.data;
  return {
    projectId: value.MEDBUDDY_GCP_PROJECT_ID,
    tasksLocation: value.MEDBUDDY_TASKS_LOCATION,
    tasksQueue: value.MEDBUDDY_TASKS_QUEUE,
    continuityCallbackUrl: value.MEDBUDDY_CONTINUITY_CALLBACK_URL,
    memoryFormationCallbackUrl: value.MEDBUDDY_MEMORY_FORMATION_CALLBACK_URL,
    passiveMemoryCallbackUrl: value.MEDBUDDY_PASSIVE_MEMORY_CALLBACK_URL,
    attachmentCallbackUrl: value.MEDBUDDY_ATTACHMENT_CALLBACK_URL,
    taskServiceAccountEmail: value.MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL,
    attachmentBucket: value.MEDBUDDY_ATTACHMENT_BUCKET,
    attachmentLocatorKeyVersion: value.MEDBUDDY_ATTACHMENT_LOCATOR_KEY_VERSION,
    attachmentLocatorKeyBase64: value.MEDBUDDY_ATTACHMENT_LOCATOR_KEY,
    vertexProjectId: value.MEDBUDDY_VERTEX_PROJECT,
    vertexLocation: value.MEDBUDDY_VERTEX_LOCATION,
    vertexModel: value.MEDBUDDY_VERTEX_MODEL,
    compactionVertexModel: value.MEDBUDDY_COMPACTION_VERTEX_MODEL,
    continuityPolicy: CONTINUITY_POLICIES[value.MEDBUDDY_CONTINUITY_PROFILE],
  };
}
