import { createProductionPlatform } from "@medbuddy/platform";

import { loadProductionConfig } from "./config.js";
import { FictionalDemoWorkspaceProvisioner } from "./demo-workspace.js";

/** Creates platform adapters after configuration validation; it performs no deployment. */
export function createProductionComposition(environment: Record<string, string | undefined>) {
  const config = loadProductionConfig(environment);
  const platform = createProductionPlatform({
    projectId: config.projectId,
    location: config.tasksLocation,
    queue: config.tasksQueue,
    callbackUrl: config.captureCallbackUrl,
    serviceAccountEmail: config.taskServiceAccountEmail,
    storageBucket: config.attachmentBucket,
  });
  return { ...platform, demoWorkspaceProvisioner: new FictionalDemoWorkspaceProvisioner(platform.persistence) };
}
