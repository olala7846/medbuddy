import type {
  AppendMessageInput,
  Message,
  MessageCursorQuery,
  MessagePage,
  WorkspaceId,
} from "@medbuddy/contracts";
import { MessageIdSchema } from "@medbuddy/contracts";

import type { BrowserAttachmentUpload } from "./attachment-input.js";
import type { TabPersonaSelection } from "./persona.js";

export interface PersistedChatApi {
  listMessages(query: MessageCursorQuery, request?: BrowserRequestMetadata): Promise<MessagePage>;
  sendMessage(input: AppendMessageInput, request?: BrowserRequestMetadata): Promise<Message>;
  uploadAttachment?(input: { workspaceId: WorkspaceId; idempotencyKey: string } & BrowserAttachmentUpload, request?: BrowserRequestMetadata): Promise<{ id: Message["attachmentIds"][number] }>;
  requestCaptureRetry?(workspaceId: WorkspaceId, messageId: Message["id"], request?: BrowserRequestMetadata): Promise<void>;
}

/** Browser request metadata; it is never an actor or a server credential. */
export interface BrowserRequestMetadata {
  headers: Readonly<Record<string, string>>;
}

export interface PersistedChatTimelineOptions {
  workspaceId: WorkspaceId;
  api: PersistedChatApi;
  idempotencyKey?: () => string;
  requestHeaders?: () => Readonly<Record<string, string>>;
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
  readonly #requestHeaders: () => Readonly<Record<string, string>>;
  #messages: Message[] = [];
  #revision = 0;

  constructor(options: PersistedChatTimelineOptions) {
    this.#workspaceId = options.workspaceId;
    this.#api = options.api;
    this.#idempotencyKey = options.idempotencyKey ?? newIdempotencyKey;
    this.#requestHeaders = options.requestHeaders ?? (() => ({}));
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
      }, this.#requestMetadata());
      this.#replaceMessages(page.messages);
      this.#revision = Math.max(this.#revision, page.nextRevision);
      after = page.nextCursor;
    } while (after !== undefined);
  }

  async send(body: string, attachments: readonly BrowserAttachmentUpload[] = []): Promise<Message> {
    const idempotencyKey = this.#idempotencyKey();
    const attachmentIds = await this.#uploadAttachments(idempotencyKey, attachments);
    const message = await this.#api.sendMessage({
      workspaceId: this.#workspaceId,
      body,
      attachmentIds,
      captureIntent: "PASSIVE",
      idempotencyKey,
    }, this.#requestMetadata());
    this.#replaceMessages([message]);
    this.#revision = Math.max(this.#revision, message.revision);
    return message;
  }

  async poll(): Promise<void> {
    const page = await this.#api.listMessages({
      workspaceId: this.#workspaceId,
      afterRevision: this.#revision,
      limit: 100,
    }, this.#requestMetadata());
    this.#replaceMessages(page.messages);
    this.#revision = page.nextRevision;
  }

  async retry(messageId: Message["id"]): Promise<void> {
    if (!this.#messages.some((message) => message.id === messageId && message.processingStatus === "FAILED")) {
      throw new Error("Only a failed message can be retried.");
    }
    if (!this.#api.requestCaptureRetry) throw new Error("Capture retry is unavailable.");
    await this.#api.requestCaptureRetry(this.#workspaceId, messageId, this.#requestMetadata());
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
    <label for="chat-attachment">Attach a fictional medication-label image</label>
    <input id="chat-attachment" name="attachment" type="file" accept="image/jpeg,image/png,image/webp" multiple>
    <p>Images only: JPEG, PNG, or WebP, up to 5 MB each. Attachments are uploaded through MedBuddy's server.</p>
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

  #requestMetadata(): BrowserRequestMetadata {
    return { headers: this.#requestHeaders() };
  }

  async #uploadAttachments(
    idempotencyKey: string,
    attachments: readonly BrowserAttachmentUpload[],
  ): Promise<AppendMessageInput["attachmentIds"]> {
    if (attachments.length === 0) return [];
    if (attachments.length > 5) throw new Error("A message can have at most five attachments.");
    if (!this.#api.uploadAttachment) throw new Error("Attachment upload is unavailable.");
    return Promise.all(attachments.map(async (attachment) => {
      const admitted = await this.#api.uploadAttachment?.(
        { workspaceId: this.#workspaceId, idempotencyKey, ...attachment },
        this.#requestMetadata(),
      );
      if (!admitted) throw new Error("Attachment upload is unavailable.");
      return admitted.id;
    }));
  }
}

function renderMessage(message: Message): string {
  const status = processingStatusText[message.processingStatus];
  const author = message.authorMemberId === "MEDBUDDY" ? "MedBuddy" : "You";
  return `<li>
  <article aria-label="Message from ${author}">
    <h2>${author}</h2>
    <p>${escapeHtml(message.body)}</p>
    <p aria-label="Processing status: ${status.label}"><strong>${status.label}:</strong> ${status.detail}</p>${message.processingStatus === "FAILED" ? `
    <button type="button" data-retry-message-id="${message.id}">Retry capture</button>` : ""}
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
  querySelector(selector: "input"): ChatBrowserAttachmentInput | null;
  querySelectorAll?(selector: "[data-retry-message-id]"): readonly ChatBrowserRetryButton[];
}

export interface ChatBrowserForm {
  addEventListener(type: "submit", listener: (event: { preventDefault(): void }) => void): void;
}

export interface ChatBrowserTextArea {
  value: string;
  focus?(): void;
}

export interface ChatBrowserRetryButton {
  getAttribute(name: "data-retry-message-id"): string | null;
  addEventListener(type: "click", listener: () => void): void;
}

export interface ChatBrowserAttachmentInput {
  files(): readonly BrowserAttachmentUpload[] | Promise<readonly BrowserAttachmentUpload[]>;
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
  const render = (renderOptions: { draft?: string; restoreFocus?: boolean } = {}) => {
    const previousTextArea = root.querySelector("textarea");
    const draft = renderOptions.draft ?? previousTextArea?.value ?? "";
    const composerWasFocused = previousTextArea !== null &&
      (root.activeElement === previousTextArea || root.ownerDocument?.activeElement === previousTextArea);
    const shouldRestoreFocus = (renderOptions.restoreFocus ?? false) && composerWasFocused;
    root.innerHTML = `${statusMessage === undefined ? "" : `<p role="alert">${statusMessage}</p>`}${timeline.render()}`;
    const form = root.querySelector("form");
    const textarea = root.querySelector("textarea");
    const attachmentInput = root.querySelector("input");
    if (!form || !textarea || !attachmentInput) throw new Error("Persisted chat markup is missing its composer.");
    textarea.value = draft;
    if (shouldRestoreFocus) textarea.focus?.();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const body = textarea.value.trim();
      if (!body) return;
      void Promise.resolve(attachmentInput.files())
        .then((attachments) => timeline.send(body, attachments))
        .then(() => {
          statusMessage = undefined;
          render();
        })
        .catch(() => {
          statusMessage = "Message was not sent. Your draft is still here; try again.";
          render({ draft: body, restoreFocus: true });
        });
    });
    for (const button of root.querySelectorAll?.("[data-retry-message-id]") ?? []) {
      const messageId = button.getAttribute("data-retry-message-id");
      if (messageId === null) continue;
      button.addEventListener("click", () => {
        void timeline.retry(MessageIdSchema.parse(messageId))
          .then(() => {
            statusMessage = "Capture retry requested. The message will update when processing finishes.";
            render({ restoreFocus: true });
          })
          .catch(() => {
            statusMessage = "Capture retry could not be requested. Try again.";
            render({ restoreFocus: true });
          });
      });
    }
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

export interface AuthenticatedChatAppOptions {
  workspaceId: WorkspaceId;
  api: PersistedChatApi;
  personaSelection: TabPersonaSelection;
  idempotencyKey?: () => string;
  pollIntervalMs?: number;
}

/** Creates the mounted browser composition with its tab-scoped persona headers. */
export async function mountAuthenticatedChatApp(
  root: ChatBrowserRoot,
  options: AuthenticatedChatAppOptions,
): Promise<MountedPersistedChatApp & { timeline: PersistedChatTimeline }> {
  const timeline = createPersistedChatTimeline({
    workspaceId: options.workspaceId,
    api: options.api,
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    requestHeaders: () => options.personaSelection.requestHeaders(),
  });
  const mounted = await mountPersistedChatApp(root, timeline, {
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
  });
  return { ...mounted, timeline };
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
