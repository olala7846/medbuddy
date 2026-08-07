import type { DynamicMemoryRecord, SourceEvent, WorkspaceId } from "@medbuddy/contracts";

import { InMemoryTransactionQueue } from "./transactions.js";

type Freshness = {
  currentSourceRef: SourceEvent["id"];
  sourceSequence: number;
  status: "ACTIVE" | "UNSENT";
};

/** Shared lock and message-lineage head used by deterministic in-memory compositions. */
export class InMemoryMemorySourceFreshnessStore {
  readonly #freshness = new Map<string, Freshness>();
  readonly #transactions = new InMemoryTransactionQueue();

  constructor(private readonly allowUntracked = false) {}

  static untrackedForTests(): InMemoryMemorySourceFreshnessStore {
    return new InMemoryMemorySourceFreshnessStore(true);
  }

  run<Result>(operation: () => Promise<Result> | Result): Promise<Result> {
    return this.#transactions.run(async () => operation());
  }

  recordAccepted(event: SourceEvent): void {
    const messageRef = event.payload.kind === "TEXT"
      ? event.providerMessageId
      : event.payload.kind === "TEXT_EDIT" || event.payload.kind === "UNSEND"
        ? event.payload.targetMessageId
        : undefined;
    if (messageRef === undefined) return;
    this.#freshness.set(this.key(event.workspaceId, messageRef), {
      currentSourceRef: event.id,
      sourceSequence: event.sourceSequence,
      status: event.payload.kind === "UNSEND" ? "UNSENT" : "ACTIVE",
    });
  }

  assertCurrent(record: DynamicMemoryRecord): void {
    const source = record.canonicalSource;
    const current = this.#freshness.get(this.key(record.workspaceId, source.messageRef));
    if (current === undefined && this.allowUntracked) return;
    if (current === undefined || current.status !== "ACTIVE" ||
        current.currentSourceRef !== source.sourceRef || current.sourceSequence !== source.sourceSequence) {
      throw new Error("Dynamic-memory source freshness is stale.");
    }
  }

  private key(workspaceId: WorkspaceId, messageRef: string): string {
    return `${workspaceId}\u0000${messageRef}`;
  }
}
