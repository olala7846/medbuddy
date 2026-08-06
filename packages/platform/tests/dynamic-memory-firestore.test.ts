import { Firestore } from "@google-cloud/firestore";
import { describeDynamicMemoryRepositoryContract } from "@medbuddy/contracts/dynamic-memory-adapter-contract-tests";
import { randomUUID } from "node:crypto";
import { afterAll, describe } from "vitest";

import { FirestoreDynamicMemoryRepository } from "../src/index.js";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("Firestore dynamic memory", () => {
  const clients: Firestore[] = [];

  describeDynamicMemoryRepositoryContract(() => {
    const firestore = new Firestore({ projectId: `medbuddy-memory-${randomUUID()}` });
    clients.push(firestore);
    return new FirestoreDynamicMemoryRepository(firestore);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.terminate()));
  });
});
