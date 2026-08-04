import {
  AttachmentTaskInputSchema,
  COMPACTION_MAX_ATTEMPTS,
  type AttachmentTaskInput,
  type ContinuityRepository,
  type PrivateAttachmentStore,
} from "@medbuddy/contracts";
import {
  createConversationPlatform,
  createLineAttachmentPlatform,
  GoogleTaskTokenVerifier,
  verifyTaskCallback,
  type TaskTokenVerifier,
} from "@medbuddy/platform";
import { z } from "zod";

import type { DownloadedLineContent } from "../line/content-client.js";
import { LineContentClient } from "../line/content-client.js";
import { LocatedLineAttachmentContentSource } from "../line/attachment.js";
import { loadContinuityConfiguration, loadLineConfiguration } from "./config.js";

export const AttachmentWorkerLogEntrySchema = z.object({
  event: z.enum([
    "attachment_task_rejected",
    "attachment_attempt_completed",
    "attachment_attempt_failed",
    "attachment_attempt_reused",
  ]),
  code: z.enum(["UNAUTHORIZED", "INVALID_BODY", "RETRYABLE", "EXHAUSTED"]).optional(),
  attempt: z.number().int().min(0).max(COMPACTION_MAX_ATTEMPTS).optional(),
  result: z.enum(["AVAILABLE", "FAILED", "REUSED"]).optional(),
  byteSizeClass: z.enum(["UNDER_1MIB", "UNDER_5MIB", "AT_MOST_10MIB"]).optional(),
}).strict();

export type AttachmentWorkerLogEntry = z.infer<typeof AttachmentWorkerLogEntrySchema>;

export interface AttachmentWorkerLogger {
  write(entry: AttachmentWorkerLogEntry): void;
}

export interface PrivateLineAttachmentContentSource {
  download(input: AttachmentTaskInput): Promise<DownloadedLineContent>;
}

function byteSizeClass(byteSize: number): AttachmentWorkerLogEntry["byteSizeClass"] {
  if (byteSize < 1024 * 1024) return "UNDER_1MIB";
  if (byteSize < 5 * 1024 * 1024) return "UNDER_5MIB";
  return "AT_MOST_10MIB";
}

function mediaClassMatchesMimeType(
  mediaClass: "IMAGE" | "PDF" | "OTHER",
  mimeType: DownloadedLineContent["mimeType"],
): boolean {
  if (mediaClass === "IMAGE") return mimeType.startsWith("image/");
  if (mediaClass === "PDF") return mimeType === "application/pdf";
  return false;
}

export class AttachmentIngestionWorker {
  constructor(private readonly dependencies: {
    continuity: ContinuityRepository;
    content: PrivateLineAttachmentContentSource;
    storage: PrivateAttachmentStore;
    logger: AttachmentWorkerLogger;
  }) {}

  async run(inputValue: AttachmentTaskInput): Promise<"AVAILABLE" | "REUSED" | "EXHAUSTED"> {
    const input = AttachmentTaskInputSchema.parse(inputValue);
    const claim = await this.dependencies.continuity.claimAttachmentAttempt(input.workspaceId, input.attachmentId);
    const attachment = claim.attachment;
    if (claim.kind === "TERMINAL" && attachment.state === "AVAILABLE") {
      this.dependencies.logger.write({ event: "attachment_attempt_reused", attempt: attachment.attempts, result: "REUSED" });
      return "REUSED";
    }
    if (claim.kind === "TERMINAL") {
      if (attachment.state !== "FAILED") {
        await this.dependencies.continuity.putAttachment({
          ...attachment,
          state: "FAILED",
          attempts: COMPACTION_MAX_ATTEMPTS,
        });
      }
      this.dependencies.logger.write({ event: "attachment_attempt_failed", code: "EXHAUSTED", attempt: COMPACTION_MAX_ATTEMPTS, result: "FAILED" });
      return "EXHAUSTED";
    }

    const attempt = attachment.attempts;
    const pending = attachment;
    try {
      const downloaded = await this.dependencies.content.download(input);
      if (!mediaClassMatchesMimeType(attachment.mediaClass, downloaded.mimeType)) {
        throw new Error("Downloaded attachment MIME type does not match its accepted media class.");
      }
      await this.dependencies.storage.saveValidated({
        workspaceId: input.workspaceId,
        attachmentId: input.attachmentId,
        mimeType: downloaded.mimeType,
        bytes: downloaded.bytes,
        checksum: downloaded.checksum,
      });
      await this.dependencies.continuity.putAttachment({
        ...pending,
        state: "AVAILABLE",
        byteSize: downloaded.bytes.byteLength,
        checksum: downloaded.checksum,
      });
      this.dependencies.logger.write({
        event: "attachment_attempt_completed",
        attempt,
        result: "AVAILABLE",
        byteSizeClass: byteSizeClass(downloaded.bytes.byteLength),
      });
      return "AVAILABLE";
    } catch (error) {
      const exhausted = attempt >= COMPACTION_MAX_ATTEMPTS;
      await this.dependencies.continuity.putAttachment({
        ...pending,
        state: exhausted ? "FAILED" : "PENDING",
      });
      this.dependencies.logger.write({
        event: "attachment_attempt_failed",
        code: exhausted ? "EXHAUSTED" : "RETRYABLE",
        attempt,
        ...(exhausted ? { result: "FAILED" as const } : {}),
      });
      if (exhausted) return "EXHAUSTED";
      throw error;
    }
  }
}

export class AttachmentTaskHandler {
  constructor(private readonly dependencies: {
    audience: string;
    serviceAccountEmail: string;
    verifier: TaskTokenVerifier;
    worker: AttachmentIngestionWorker;
    logger: AttachmentWorkerLogger;
  }) {}

  async handle(input: { authorization: string | undefined; body: unknown }): Promise<{ status: 200 | 400 | 401 | 500 }> {
    try {
      await verifyTaskCallback({
        authorization: input.authorization,
        audience: this.dependencies.audience,
        serviceAccountEmail: this.dependencies.serviceAccountEmail,
        verifier: this.dependencies.verifier,
      });
    } catch {
      this.dependencies.logger.write({ event: "attachment_task_rejected", code: "UNAUTHORIZED" });
      return { status: 401 };
    }
    let body = input.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body) as unknown;
      } catch {
        body = undefined;
      }
    }
    const parsed = AttachmentTaskInputSchema.safeParse(body);
    if (!parsed.success) {
      this.dependencies.logger.write({ event: "attachment_task_rejected", code: "INVALID_BODY" });
      return { status: 400 };
    }
    try {
      await this.dependencies.worker.run(parsed.data);
      return { status: 200 };
    } catch {
      return { status: 500 };
    }
  }
}

export function createAttachmentTaskComposition(
  environment: Record<string, string | undefined>,
  logger: AttachmentWorkerLogger,
): AttachmentTaskHandler {
  const line = loadLineConfiguration(environment);
  const configuration = loadContinuityConfiguration(environment);
  const conversation = createConversationPlatform(configuration.projectId);
  const attachment = createLineAttachmentPlatform({
    projectId: configuration.projectId,
    location: configuration.tasksLocation,
    queue: configuration.tasksQueue,
    callbackUrl: configuration.attachmentCallbackUrl,
    serviceAccountEmail: configuration.taskServiceAccountEmail,
    storageBucket: configuration.attachmentBucket,
    locatorKeyVersion: configuration.attachmentLocatorKeyVersion,
    locatorKeyBase64: configuration.attachmentLocatorKeyBase64,
  });
  return new AttachmentTaskHandler({
    audience: configuration.attachmentCallbackUrl,
    serviceAccountEmail: configuration.taskServiceAccountEmail,
    verifier: new GoogleTaskTokenVerifier(),
    worker: new AttachmentIngestionWorker({
      continuity: conversation.continuity,
      content: new LocatedLineAttachmentContentSource({
        locator: attachment.locator,
        content: new LineContentClient(line.channelAccessToken),
      }),
      storage: attachment.storage,
      logger,
    }),
    logger,
  });
}

let taskHandler: AttachmentTaskHandler | undefined;
const productionAttachmentLogger: AttachmentWorkerLogger = {
  write(entry) {
    console.info(JSON.stringify(AttachmentWorkerLogEntrySchema.parse(entry)));
  },
};

export function getAttachmentTaskHandler(): AttachmentTaskHandler {
  taskHandler ??= createAttachmentTaskComposition(process.env, productionAttachmentLogger);
  return taskHandler;
}
