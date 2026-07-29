import type {
  AppendMessageInput,
  Message,
  MessageCursorQuery,
  MessagePage,
  WorkspaceId,
} from "@medbuddy/contracts";

export interface PersistedChatApi {
  listMessages(query: MessageCursorQuery): Promise<MessagePage>;
  sendMessage(input: AppendMessageInput): Promise<Message>;
}

export interface PersistedChatTimelineOptions {
  workspaceId: WorkspaceId;
  api: PersistedChatApi;
  idempotencyKey?: () => string;
}

const processingStatusText: Record<Message["processingStatus"], { label: string; detail: string }> = {
  PENDING: { label: "Pending", detail: "waiting to be captured for review." },
  PROCESSING: { label: "Processing", detail: "capture is in progress." },
  CAPTURED: { label: "Captured", detail: "available for review." },
  IGNORED: { label: "Ignored", detail: "no item was captured." },
  NEEDS_MANUAL_REVIEW: { label: "Manual review needed", detail: "capture was uncertain." },
  FAILED: { label: "Failed", detail: "capture could not finish." },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function compareMessages(left: Message, right: Message): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function newIdempotencyKey(): string {
  return `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A browser-facing timeline controller. It only requests persisted messages
 * through a server API; it never receives repositories or Intelligence ports.
 */
export class PersistedChatTimeline {
  readonly #workspaceId: WorkspaceId;
  readonly #api: PersistedChatApi;
  readonly #idempotencyKey: () => string;
  #messages: Message[] = [];
  #revision = 0;

  constructor(options: PersistedChatTimelineOptions) {
    this.#workspaceId = options.workspaceId;
    this.#api = options.api;
    this.#idempotencyKey = options.idempotencyKey ?? newIdempotencyKey;
  }

  get messages(): readonly Message[] {
    return this.#messages;
  }

  async load(): Promise<void> {
    let after: MessageCursorQuery["after"];
    do {
      const page = await this.#api.listMessages({
        workspaceId: this.#workspaceId,
        after,
        limit: 100,
      });
      this.#replaceMessages(page.messages);
      this.#revision = Math.max(this.#revision, page.nextRevision);
      after = page.nextCursor;
    } while (after !== undefined);
  }

  async send(body: string): Promise<Message> {
    const message = await this.#api.sendMessage({
      workspaceId: this.#workspaceId,
      body,
      attachmentIds: [],
      captureIntent: "PASSIVE",
      idempotencyKey: this.#idempotencyKey(),
    });
    this.#replaceMessages([message]);
    this.#revision = Math.max(this.#revision, message.revision);
    return message;
  }

  async poll(): Promise<void> {
    const page = await this.#api.listMessages({
      workspaceId: this.#workspaceId,
      afterRevision: this.#revision,
      limit: 100,
    });
    this.#replaceMessages(page.messages);
    this.#revision = page.nextRevision;
  }

  render(): string {
    const messageList = this.#messages.length === 0
      ? '<p role="status">No messages yet. Send a message to start the shared record.</p>'
      : this.#messages.map(renderMessage).join("\n");
    return `<main aria-labelledby="chat-title">
  <h1 id="chat-title">MedBuddy conversation</h1>
  <p>Messages are stored in this fictional workspace. MedBuddy organizes information for review and does not make medical decisions.</p>
  <section aria-label="Conversation messages">
    <ol>${messageList}</ol>
  </section>
  <form aria-label="Send a message">
    <label for="chat-message">Message</label>
    <textarea id="chat-message" name="message" required maxlength="10000"></textarea>
    <button type="submit">Send message</button>
  </form>
</main>`;
  }

  #replaceMessages(updates: readonly Message[]): void {
    const byId = new Map(this.#messages.map((message) => [message.id, message]));
    for (const update of updates) {
      const existing = byId.get(update.id);
      if (existing === undefined || update.revision >= existing.revision) byId.set(update.id, update);
    }
    this.#messages = [...byId.values()].sort(compareMessages);
  }
}

function renderMessage(message: Message): string {
  const status = processingStatusText[message.processingStatus];
  const author = message.authorMemberId === "MEDBUDDY" ? "MedBuddy" : "You";
  return `<li>
  <article aria-label="Message from ${author}">
    <h2>${author}</h2>
    <p>${escapeHtml(message.body)}</p>
    <p aria-label="Processing status: ${status.label}"><strong>${status.label}:</strong> ${status.detail}</p>
  </article>
</li>`;
}

export function createPersistedChatTimeline(options: PersistedChatTimelineOptions): PersistedChatTimeline {
  return new PersistedChatTimeline(options);
}

export interface ChatBrowserRoot {
  innerHTML: string;
  activeElement?: unknown;
  ownerDocument?: { activeElement: unknown };
  querySelector(selector: "form"): ChatBrowserForm | null;
  querySelector(selector: "textarea"): ChatBrowserTextArea | null;
}

export interface ChatBrowserForm {
  addEventListener(type: "submit", listener: (event: { preventDefault(): void }) => void): void;
}

export interface ChatBrowserTextArea {
  value: string;
  focus?(): void;
}

export interface MountedPersistedChatApp {
  poll(): Promise<void>;
  unmount(): void;
}

/** Mounts the timeline in a browser root and wires its composer plus polling. */
export async function mountPersistedChatApp(
  root: ChatBrowserRoot,
  timeline: PersistedChatTimeline,
  options: { pollIntervalMs?: number } = {},
): Promise<MountedPersistedChatApp> {
  let statusMessage: string | undefined;
  const render = (options: { draft?: string; restoreFocus?: boolean } = {}) => {
    const previousTextArea = root.querySelector("textarea");
    const draft = options.draft ?? previousTextArea?.value ?? "";
    const composerWasFocused = previousTextArea !== null &&
      (root.activeElement === previousTextArea || root.ownerDocument?.activeElement === previousTextArea);
    const shouldRestoreFocus = (options.restoreFocus ?? false) && composerWasFocused;
    root.innerHTML = `${statusMessage === undefined ? "" : `<p role="alert">${statusMessage}</p>`}${timeline.render()}`;
    const form = root.querySelector("form");
    const textarea = root.querySelector("textarea");
    if (!form || !textarea) throw new Error("Persisted chat markup is missing its composer.");
    textarea.value = draft;
    if (shouldRestoreFocus) textarea.focus?.();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      if (!body) return;
      void timeline.send(body)
        .then(() => {
          statusMessage = undefined;
          render();
        })
        .catch(() => {
          statusMessage = "Message was not sent. Your draft is still here; try again.";
          render({ draft: body, restoreFocus: true });
        });
    });
  };
  const poll = async () => {
    try {
      await timeline.poll();
      statusMessage = undefined;
    } catch {
      statusMessage = "Messages could not refresh. Your draft is still here; try again.";
    }
    render({ restoreFocus: true });
  };

  await timeline.load();
  render();
  const timer = setInterval(() => { void poll(); }, options.pollIntervalMs ?? 5_000);
  return {
    poll,
    unmount() {
      clearInterval(timer);
    },
  };
}

export function renderLoginPage(): string {
  return `<main aria-labelledby="login-title">
  <h1 id="login-title">Sign in to MedBuddy</h1>
  <p>Use the fictional demo to review shared health information. Do not enter real health information.</p>
  <button type="button">Sign in with Google</button>
  <p>Google sign-in is for allowlisted prototype reviewers.</p>
  <button type="button">Use a fictional participant account</button>
  <p>Fictional participant accounts stay assigned to their configured participant.</p>
</main>`;
}
