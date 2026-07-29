import { MemberIdSchema, WorkspaceIdSchema, type MemberId, type WorkspaceId } from "@medbuddy/contracts";

/** The sole browser-to-server persona hint accepted by actor resolution. */
export const MEDBUDDY_DEMO_MEMBER_HEADER = "X-MedBuddy-Demo-Member";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TabPersonaSelectionOptions {
  workspaceId: WorkspaceId;
  storage: SessionStorageLike;
  /** Only allowlisted Google prototype-reviewer sessions may assume a persona. */
  isGoogleReviewer: boolean;
}

function personaStorageKey(workspaceId: WorkspaceId): string {
  return `medbuddy:demo-member:${workspaceId}`;
}

/** Holds the simulation-only persona for one browser tab. */
export class TabPersonaSelection {
  readonly #workspaceId: WorkspaceId;
  readonly #storage: SessionStorageLike;
  readonly #isGoogleReviewer: boolean;

  constructor(options: TabPersonaSelectionOptions) {
    this.#workspaceId = WorkspaceIdSchema.parse(options.workspaceId);
    this.#storage = options.storage;
    this.#isGoogleReviewer = options.isGoogleReviewer;
  }

  get memberId(): MemberId | undefined {
    if (!this.#isGoogleReviewer) return undefined;
    const parsed = MemberIdSchema.safeParse(this.#storage.getItem(personaStorageKey(this.#workspaceId)));
    return parsed.success ? parsed.data : undefined;
  }

  select(memberId: string): void {
    if (!this.#isGoogleReviewer) return;
    this.#storage.setItem(personaStorageKey(this.#workspaceId), MemberIdSchema.parse(memberId));
  }

  clear(): void {
    this.#storage.removeItem(personaStorageKey(this.#workspaceId));
  }

  requestHeaders(): Readonly<Record<string, string>> {
    const memberId = this.memberId;
    return memberId === undefined ? {} : { [MEDBUDDY_DEMO_MEMBER_HEADER]: memberId };
  }
}

export function createTabPersonaSelection(options: TabPersonaSelectionOptions): TabPersonaSelection {
  return new TabPersonaSelection(options);
}
