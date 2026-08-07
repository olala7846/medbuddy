import { describeDynamicMemoryRepositoryContract } from "@medbuddy/contracts/dynamic-memory-adapter-contract-tests";

import { InMemoryDynamicMemoryRepository, InMemoryMemorySourceFreshnessStore } from "../src/index.js";

describeDynamicMemoryRepositoryContract(() => new InMemoryDynamicMemoryRepository(
  InMemoryMemorySourceFreshnessStore.untrackedForTests(),
));
