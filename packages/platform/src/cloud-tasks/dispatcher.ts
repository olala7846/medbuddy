import { CloudTasksClient } from "@google-cloud/tasks";
import {
  AttachmentTaskInputSchema,
  CaptureJobInputSchema,
  ContinuityTaskInputSchema,
  type AttachmentTaskDispatcher,
  type CaptureDispatcher,
  type ContinuityTaskDispatcher,
} from "@medbuddy/contracts";
import { createHash } from "node:crypto";

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
    const taskId = `capture-${createHash("sha256").update(JSON.stringify(canonicalInput)).digest("hex")}`;
    try {
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
    } catch (error) {
      if ((error as { code?: unknown }).code !== 6 && (error as { code?: unknown }).code !== "ALREADY_EXISTS") {
        throw error;
      }
    }
  }
}

/**
 * Creates a deterministic OIDC-authenticated task. Cloud Tasks de-duplicates
 * explicit task names; ALREADY_EXISTS therefore means dispatch already won.
 * Source: https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
 */
export class CloudTasksContinuityDispatcher implements ContinuityTaskDispatcher {
  constructor(
    private readonly client: Pick<CloudTasksClient, "queuePath" | "taskPath" | "createTask">,
    private readonly options: CloudTasksDispatcherOptions,
  ) {}

  async dispatch(inputValue: Parameters<ContinuityTaskDispatcher["dispatch"]>[0]): Promise<void> {
    const input = ContinuityTaskInputSchema.parse(inputValue);
    const parent = this.client.queuePath(this.options.projectId, this.options.location, this.options.queue);
    const taskId = `continuity-${input.jobId.slice("compaction-job:".length)}`;
    try {
      await this.client.createTask({
        parent,
        task: {
          name: this.client.taskPath(this.options.projectId, this.options.location, this.options.queue, taskId),
          httpRequest: {
            httpMethod: "POST",
            url: this.options.callbackUrl,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify(input)).toString("base64"),
            oidcToken: {
              serviceAccountEmail: this.options.serviceAccountEmail,
              audience: this.options.callbackUrl,
            },
          },
        },
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== 6 && (error as { code?: unknown }).code !== "ALREADY_EXISTS") {
        throw error;
      }
    }
  }
}

export class CloudTasksAttachmentDispatcher implements AttachmentTaskDispatcher {
  constructor(
    private readonly client: Pick<CloudTasksClient, "queuePath" | "taskPath" | "createTask">,
    private readonly options: CloudTasksDispatcherOptions,
  ) {}

  async dispatch(inputValue: Parameters<AttachmentTaskDispatcher["dispatch"]>[0]): Promise<void> {
    const input = AttachmentTaskInputSchema.parse(inputValue);
    const parent = this.client.queuePath(this.options.projectId, this.options.location, this.options.queue);
    const taskId = `attachment-${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
    try {
      await this.client.createTask({
        parent,
        task: {
          name: this.client.taskPath(this.options.projectId, this.options.location, this.options.queue, taskId),
          httpRequest: {
            httpMethod: "POST",
            url: this.options.callbackUrl,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify(input)).toString("base64"),
            oidcToken: {
              serviceAccountEmail: this.options.serviceAccountEmail,
              audience: this.options.callbackUrl,
            },
          },
        },
      });
    } catch (error) {
      if ((error as { code?: unknown }).code !== 6 && (error as { code?: unknown }).code !== "ALREADY_EXISTS") {
        throw error;
      }
    }
  }
}
