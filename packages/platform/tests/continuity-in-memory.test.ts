import { describeContinuityRepositoryContract } from "@medbuddy/contracts/continuity-adapter-contract-tests";

import { InMemoryContinuityRepository } from "../src/in-memory/continuity.js";

describeContinuityRepositoryContract(() => ({
  continuity: new InMemoryContinuityRepository(),
}));
