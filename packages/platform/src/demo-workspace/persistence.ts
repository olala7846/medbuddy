import {
  DemoWorkspaceMappingSchema,
  type DemoWorkspaceMapping,
  type DemoWorkspaceResetInput,
  type FactDocument,
  type HandoffVersionDocument,
  type MemberDocument,
  type MessageDocument,
  type PersistenceRepositories,
  type WorkspaceDocument,
} from "@medbuddy/contracts";

import { InMemoryPersistence } from "../in-memory/repositories.js";

export interface DemoWorkspaceMappingRepository {
  get(accountId: DemoWorkspaceMapping["accountId"]): Promise<DemoWorkspaceMapping | null>;
  put(mapping: DemoWorkspaceMapping): Promise<void>;
}

export interface DemoWorkspaceResetResultRepository {
  get(input: DemoWorkspaceResetInput): Promise<DemoWorkspaceMapping | null>;
  put(input: DemoWorkspaceResetInput, mapping: DemoWorkspaceMapping): Promise<void>;
}

export interface DemoWorkspaceSeed {
  workspace: WorkspaceDocument;
  members: readonly MemberDocument[];
  messages: readonly MessageDocument[];
  facts: readonly FactDocument[];
  handoffs: readonly HandoffVersionDocument[];
}

export interface DemoWorkspaceTransaction {
  repositories: PersistenceRepositories;
  mappings: DemoWorkspaceMappingRepository;
  resetResults: DemoWorkspaceResetResultRepository;
  seed(seed: DemoWorkspaceSeed): Promise<void>;
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
  #resetResults = new Map<string, DemoWorkspaceMapping>();

  constructor(readonly persistence = new InMemoryPersistence()) {}

  async runDemoWorkspaceTransaction<Result>(
    operation: (transaction: DemoWorkspaceTransaction) => Promise<Result>,
  ): Promise<Result> {
    const stagedMappings = new Map(
      [...this.#mappings].map(([key, value]) => [key, structuredClone(value)]),
    );
    const stagedResetResults = new Map(
      [...this.#resetResults].map(([key, value]) => [key, structuredClone(value)]),
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
        resetResults: {
          get: async (input) => structuredClone(stagedResetResults.get(resetKey(input)) ?? null),
          put: async (input, mapping) => {
            stagedResetResults.set(resetKey(input), DemoWorkspaceMappingSchema.parse(mapping));
          },
        },
        seed: async (seed) => {
          await repositories.workspaces.putWorkspace(seed.workspace);
          for (const member of seed.members) await repositories.members.putMember(member);
          for (const message of seed.messages) await repositories.messages.putMessage(message);
          for (const fact of seed.facts) await repositories.careRecords.putFact(fact);
          for (const handoff of seed.handoffs) await repositories.careRecords.createHandoff(handoff);
        },
      });
      this.#mappings = stagedMappings;
      this.#resetResults = stagedResetResults;
      return result;
    });
  }
}

function resetKey(input: DemoWorkspaceResetInput): string {
  return `${input.accountId}\u0000${input.idempotencyKey}`;
}
