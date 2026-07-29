import { CloudTasksClient } from "@google-cloud/tasks";
import { CaptureJobInputSchema, type CaptureDispatcher } from "@medbuddy/contracts";

export interface CloudTasksDispatcherOptions {
  projectId: string;
  location: string;
  queue: string;
  callbackUrl: string;
  serviceAccountEmail: string;
}

export class CloudTasksCaptureDispatcher implements CaptureDispatcher {
  constructor(
    private readonly client: Pick<CloudTasksClient, "queuePath" | "taskPath" | "createTask">,
    private readonly options: CloudTasksDispatcherOptions,
  ) {}

  async dispatch(input: Parameters<CaptureDispatcher["dispatch"]>[0]): Promise<void> {
    const canonicalInput = CaptureJobInputSchema.parse(input);
    const parent = this.client.queuePath(this.options.projectId, this.options.location, this.options.queue);
    const taskId = `${canonicalInput.workspaceId}-${canonicalInput.messageId}`.replace(/[^A-Za-z0-9_-]/g, "_");
    await this.client.createTask({
      parent,
      task: {
        name: this.client.taskPath(this.options.projectId, this.options.location, this.options.queue, taskId),
        httpRequest: {
          httpMethod: "POST",
          url: this.options.callbackUrl,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify(canonicalInput)).toString("base64"),
          oidcToken: {
            serviceAccountEmail: this.options.serviceAccountEmail,
            audience: this.options.callbackUrl,
          },
        },
      },
    });
  }
}
