import { Firestore } from "@google-cloud/firestore";
import { describePassiveMemoryAdapterContract } from "@medbuddy/contracts/passive-memory-adapter-contract-tests";
import { randomUUID } from "node:crypto";
import { afterAll, describe } from "vitest";

import {
  FirestoreContinuityRepository,
  FirestoreDynamicMemoryRepository,
  FirestorePassiveMemoryJobRepository,
  PassiveMemoryEvidenceReaderAdapter,
} from "../src/index.js";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("Firestore passive memory", () => {
  const clients: Firestore[] = [];
  describePassiveMemoryAdapterContract(() => {
    const firestore = new Firestore({ projectId: `medbuddy-passive-memory-${randomUUID()}` });
    clients.push(firestore);
    const continuity = new FirestoreContinuityRepository(firestore);
    const jobs = new FirestorePassiveMemoryJobRepository(firestore);
    return {
      continuity,
      evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
      jobs,
      memory: new FirestoreDynamicMemoryRepository(firestore),
      ledger: continuity,
    };
  });

  afterAll(async () => Promise.all(clients.map((client) => client.terminate())));
});
