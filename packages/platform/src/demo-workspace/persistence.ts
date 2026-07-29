import {
  DemoWorkspaceMappingSchema,
  type DemoWorkspaceMapping,
  type PersistenceRepositories,
} from "@medbuddy/contracts";

import { InMemoryPersistence } from "../in-memory/repositories.js";

export interface DemoWorkspaceMappingRepository {
  get(accountId: DemoWorkspaceMapping["accountId"]): Promise<DemoWorkspaceMapping | null>;
  put(mapping: DemoWorkspaceMapping): Promise<void>;
}

export interface DemoWorkspaceTransaction {
  repositories: PersistenceRepositories;
  mappings: DemoWorkspaceMappingRepository;
}

export interface DemoWorkspacePersistence {
  runDemoWorkspaceTransaction<Result>(
    operation: (transaction: DemoWorkspaceTransaction) => Promise<Result>,
  ): Promise<Result>;
}

/**
 * Test composition counterpart to Firestore's transactional reviewer mapping.
 * Mappings are staged with the domain records so a failed reset has no effect.
 */
export class InMemoryDemoWorkspacePersistence implements DemoWorkspacePersistence {
  #mappings = new Map<string, DemoWorkspaceMapping>();

  constructor(readonly persistence = new InMemoryPersistence()) {}

  async runDemoWorkspaceTransaction<Result>(
    operation: (transaction: DemoWorkspaceTransaction) => Promise<Result>,
  ): Promise<Result> {
    const stagedMappings = new Map(
      [...this.#mappings].map(([key, value]) => [key, structuredClone(value)]),
    );
    return this.persistence.runTransaction(async (repositories) => {
      const result = await operation({
        repositories,
        mappings: {
          get: async (accountId) => structuredClone(stagedMappings.get(accountId) ?? null),
          put: async (mapping) => {
            const parsed = DemoWorkspaceMappingSchema.parse(mapping);
            stagedMappings.set(parsed.accountId, structuredClone(parsed));
          },
        },
      });
      this.#mappings = stagedMappings;
      return result;
    });
  }
}
