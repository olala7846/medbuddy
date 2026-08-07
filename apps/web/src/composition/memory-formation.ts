import { DynamicMemoryService, MemoryFormationScheduler } from "@medbuddy/chat";
import {
  MEMORY_FORMATION_POLICIES,
  MemoryFormationRecoveryInputSchema,
  MemoryFormationWakeInputSchema,
} from "@medbuddy/contracts";
import {
  GoogleTaskTokenVerifier,
  createConversationPlatform,
  createMemoryFormationDispatchers,
  verifyTaskCallback,
  type TaskTokenVerifier,
} from "@medbuddy/platform";
import { loadContinuityConfiguration } from "./config.js";

export class MemoryFormationTaskHandler {
  constructor(private readonly dependencies: {
    audience: string;
    serviceAccountEmail: string;
    verifier: TaskTokenVerifier;
    scheduler: MemoryFormationScheduler;
  }) {}

  async authorize(authorization: string | undefined): Promise<boolean> {
    try {
      await verifyTaskCallback({ authorization, audience: this.dependencies.audience,
        serviceAccountEmail: this.dependencies.serviceAccountEmail, verifier: this.dependencies.verifier });
      return true;
    } catch { return false; }
  }

  async handleAuthenticated(value: unknown): Promise<{ status: 200 | 400 | 500 }> {
    let body = value;
    if (typeof body === "string") { try { body = JSON.parse(body) as unknown; } catch { return { status: 400 }; } }
    const recovery = MemoryFormationRecoveryInputSchema.safeParse(body);
    try {
      if (recovery.success) { await this.dependencies.scheduler.recover(); return { status: 200 }; }
      const wake = MemoryFormationWakeInputSchema.safeParse(body);
      if (!wake.success) return { status: 400 };
      await this.dependencies.scheduler.wake(wake.data);
      return { status: 200 };
    } catch { return { status: 500 }; }
  }
}

export function createMemoryFormationTaskComposition(environment: Record<string, string | undefined>) {
  const config = loadContinuityConfiguration(environment);
  const platform = createConversationPlatform(config.projectId);
  const dispatchers = createMemoryFormationDispatchers({
    projectId: config.projectId, location: config.tasksLocation, queue: config.tasksQueue,
    formationCallbackUrl: config.memoryFormationCallbackUrl,
    passiveMemoryCallbackUrl: config.passiveMemoryCallbackUrl,
    serviceAccountEmail: config.taskServiceAccountEmail,
  });
  return new MemoryFormationTaskHandler({
    audience: config.memoryFormationCallbackUrl,
    serviceAccountEmail: config.taskServiceAccountEmail,
    verifier: new GoogleTaskTokenVerifier(),
    scheduler: new MemoryFormationScheduler({ repository: platform.continuity, jobs: platform.passiveJobs,
      wakeDispatcher: dispatchers.wake, workerDispatcher: dispatchers.worker,
      policy: MEMORY_FORMATION_POLICIES[config.continuityPolicy.profile], now: () => new Date().toISOString(),
      lifecycleCleanup: async (workspaceId, sourceEventId) => {
        const source = await platform.continuity.getSourceEvent(workspaceId, sourceEventId);
        if (source === null) throw new Error("Formation lifecycle source is missing.");
        await new DynamicMemoryService(platform.memory, undefined, platform.continuity)
          .applySourceMutation(workspaceId, source);
      },
    }),
  });
}

let handler: MemoryFormationTaskHandler | undefined;
export function getMemoryFormationTaskHandler() {
  handler ??= createMemoryFormationTaskComposition(process.env);
  return handler;
}
