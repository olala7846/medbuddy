import { describeDynamicMemoryRepositoryContract } from "@medbuddy/contracts/dynamic-memory-adapter-contract-tests";

import { InMemoryDynamicMemoryRepository } from "../src/index.js";

describeDynamicMemoryRepositoryContract(() => new InMemoryDynamicMemoryRepository());
