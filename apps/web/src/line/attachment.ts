import {
  AttachmentTaskInputSchema,
  type AttachmentTaskDispatcher,
  type AttachmentTaskInput,
} from "@medbuddy/contracts";

import type { DownloadedLineContent, LineContentClient } from "./content-client.js";

export interface PrivateLineAttachmentLocator {
  put(input: AttachmentTaskInput & { providerMessageId: string }): Promise<void>;
  resolve(input: AttachmentTaskInput): Promise<string>;
}

export interface LineAttachmentCoordinator {
  prepare(input: AttachmentTaskInput & { providerMessageId: string }): Promise<void>;
}

export class DurableLineAttachmentCoordinator implements LineAttachmentCoordinator {
  constructor(private readonly dependencies: {
    locator: PrivateLineAttachmentLocator;
    dispatcher: AttachmentTaskDispatcher;
  }) {}

  async prepare(inputValue: AttachmentTaskInput & { providerMessageId: string }): Promise<void> {
    const input = AttachmentTaskInputSchema.parse({
      workspaceId: inputValue.workspaceId,
      attachmentId: inputValue.attachmentId,
    });
    await this.dependencies.locator.put({ ...input, providerMessageId: inputValue.providerMessageId });
    await this.dependencies.dispatcher.dispatch(input);
  }
}

export class LocatedLineAttachmentContentSource {
  constructor(private readonly dependencies: {
    locator: PrivateLineAttachmentLocator;
    content: Pick<LineContentClient, "download">;
  }) {}

  async download(inputValue: AttachmentTaskInput): Promise<DownloadedLineContent> {
    const input = AttachmentTaskInputSchema.parse(inputValue);
    const providerMessageId = await this.dependencies.locator.resolve(input);
    return this.dependencies.content.download(providerMessageId);
  }
}
