import { Firestore } from "@google-cloud/firestore";
import { CloudTasksClient } from "@google-cloud/tasks";
import { Storage } from "@google-cloud/storage";

import {
  CloudTasksCaptureDispatcher,
  CloudTasksAttachmentDispatcher,
  CloudTasksContinuityDispatcher,
  CloudTasksMemoryFormationDispatcher,
  CloudTasksPassiveMemoryDispatcher,
  type CloudTasksDispatcherOptions,
} from "./cloud-tasks/dispatcher.js";
import { FirestorePersistence } from "./firestore/repositories.js";
import { FirestoreContinuityRepository } from "./firestore/continuity.js";
import { FirestoreDynamicMemoryRepository } from "./firestore/dynamic-memory.js";
import { FirestorePassiveMemoryJobRepository } from "./firestore/passive-memory.js";
import { PassiveMemoryEvidenceReaderAdapter } from "./passive-memory.js";
import { PrivateAttachmentStorage } from "./storage/attachments.js";
import { ContinuityPrivateAttachmentStorage } from "./storage/attachments.js";
import { EncryptedLineAttachmentLocatorStore, FirestoreAttachmentLocatorDocuments } from "./firestore/attachment-locator.js";

export interface ProductionPlatformOptions extends CloudTasksDispatcherOptions {
  storageBucket: string;
}

/** Minimal Firestore-only platform for synchronous external conversations. */
export function createConversationPlatform(projectId: string) {
  const firestore = new Firestore({ projectId });
  return {
    persistence: new FirestorePersistence(firestore),
    continuity: new FirestoreContinuityRepository(firestore),
    memory: new FirestoreDynamicMemoryRepository(firestore),
    passiveJobs: new FirestorePassiveMemoryJobRepository(firestore),
  };
}

/** Storage-only composition for the internal passive worker; it schedules nothing. */
export function createPassiveMemoryPlatform(projectId: string) {
  const firestore = new Firestore({ projectId });
  const continuity = new FirestoreContinuityRepository(firestore);
  return {
    continuity,
    evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
    jobs: new FirestorePassiveMemoryJobRepository(firestore),
    memory: new FirestoreDynamicMemoryRepository(firestore),
  };
}

export function createContinuityDispatcher(options: CloudTasksDispatcherOptions) {
  return new CloudTasksContinuityDispatcher(new CloudTasksClient(), options);
}

export function createMemoryFormationDispatchers(options: Omit<CloudTasksDispatcherOptions, "callbackUrl"> & {
  formationCallbackUrl: string;
  passiveMemoryCallbackUrl: string;
}) {
  const client = new CloudTasksClient();
  return {
    wake: new CloudTasksMemoryFormationDispatcher(client, { ...options, callbackUrl: options.formationCallbackUrl }),
    worker: new CloudTasksPassiveMemoryDispatcher(client, { ...options, callbackUrl: options.passiveMemoryCallbackUrl }),
  };
}

export function createLineAttachmentPlatform(options: CloudTasksDispatcherOptions & {
  storageBucket: string;
  locatorKeyVersion: string;
  locatorKeyBase64: string;
}) {
  const firestore = new Firestore({ projectId: options.projectId });
  return {
    locator: new EncryptedLineAttachmentLocatorStore(
      new FirestoreAttachmentLocatorDocuments(firestore),
      { version: options.locatorKeyVersion, keyBase64: options.locatorKeyBase64 },
    ),
    dispatcher: new CloudTasksAttachmentDispatcher(new CloudTasksClient(), options),
    storage: new ContinuityPrivateAttachmentStorage(
      new Storage({ projectId: options.projectId }),
      options.storageBucket,
    ),
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
    continuity: new FirestoreContinuityRepository(firestore),
    captureDispatcher: new CloudTasksCaptureDispatcher(new CloudTasksClient(), options),
    attachmentStorage: new PrivateAttachmentStorage(new Storage({ projectId: options.projectId }), options.storageBucket),
  };
}
