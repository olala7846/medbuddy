import { describePassiveMemoryAdapterContract } from "@medbuddy/contracts/passive-memory-adapter-contract-tests";

import {
  InMemoryContinuityRepository,
  InMemoryPassiveMemoryJobRepository,
  PassiveMemoryEvidenceReaderAdapter,
} from "../src/index.js";

describePassiveMemoryAdapterContract(() => {
  const continuity = new InMemoryContinuityRepository();
  return {
    continuity,
    evidence: new PassiveMemoryEvidenceReaderAdapter(continuity),
    jobs: new InMemoryPassiveMemoryJobRepository(),
  };
});
