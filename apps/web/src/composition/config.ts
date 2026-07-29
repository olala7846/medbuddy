import { z } from "zod";

const RequiredProductionConfigSchema = z.object({
  MEDBUDDY_GCP_PROJECT_ID: z.string().trim().min(1),
  MEDBUDDY_TASKS_LOCATION: z.string().trim().min(1),
  MEDBUDDY_TASKS_QUEUE: z.string().trim().min(1),
  MEDBUDDY_CAPTURE_CALLBACK_URL: z.string().url(),
  MEDBUDDY_TASKS_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  MEDBUDDY_ATTACHMENT_BUCKET: z.string().trim().min(3),
});

export type ProductionConfig = {
  projectId: string;
  tasksLocation: string;
  tasksQueue: string;
  captureCallbackUrl: string;
  taskServiceAccountEmail: string;
  attachmentBucket: string;
};

/** Safe startup error: it names missing keys but never echoes values or secrets. */
export class ProductionConfigurationError extends Error {
  constructor(readonly missingKeys: readonly string[]) {
    super(`Production configuration is incomplete: ${missingKeys.join(", ")}.`);
  }
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
