import { Firestore } from "@google-cloud/firestore";
import { CloudTasksClient } from "@google-cloud/tasks";
import { Storage } from "@google-cloud/storage";

import { CloudTasksCaptureDispatcher, type CloudTasksDispatcherOptions } from "./cloud-tasks/dispatcher.js";
import { FirestorePersistence } from "./firestore/repositories.js";
import { PrivateAttachmentStorage } from "./storage/attachments.js";

export interface ProductionPlatformOptions extends CloudTasksDispatcherOptions {
  storageBucket: string;
}

/** Minimal Firestore-only platform for synchronous external conversations. */
export function createConversationPlatform(projectId: string) {
  return {
    persistence: new FirestorePersistence(new Firestore({ projectId })),
  };
}

/**
 * Creates adapters only. Constructing this value does not contact GCP or
 * authorize a caller; request and domain policy stay in the web/domain layers.
 */
export function createProductionPlatform(options: ProductionPlatformOptions) {
  const firestore = new Firestore({ projectId: options.projectId });
  return {
    persistence: new FirestorePersistence(firestore),
    captureDispatcher: new CloudTasksCaptureDispatcher(new CloudTasksClient(), options),
    attachmentStorage: new PrivateAttachmentStorage(new Storage({ projectId: options.projectId }), options.storageBucket),
  };
}
