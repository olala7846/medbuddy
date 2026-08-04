import { Firestore } from "@google-cloud/firestore";
import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { describeContinuityRepositoryContract } from "@medbuddy/contracts/continuity-adapter-contract-tests";

import { FirestoreContinuityRepository } from "../src/firestore/continuity.js";

const describeEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeEmulator("Firestore continuity repository", () => {
  describeContinuityRepositoryContract(() => ({
    continuity: new FirestoreContinuityRepository(new Firestore({
      projectId: `medbuddy-continuity-test-${randomUUID()}`,
    })),
  }));
});
