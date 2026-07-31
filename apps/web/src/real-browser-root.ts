import type {
  ChatBrowserAttachmentInput,
  ChatBrowserForm,
  ChatBrowserRetryButton,
  ChatBrowserRoot,
  ChatBrowserTextArea,
} from "./persisted-chat.js";

export class RealBrowserRoot implements ChatBrowserRoot {
  constructor(private readonly element: HTMLElement) {}

  get innerHTML(): string {
    return this.element.innerHTML;
  }

  set innerHTML(value: string) {
    this.element.innerHTML = value;
  }

  get activeElement(): unknown {
    return document.activeElement;
  }

  get ownerDocument() {
    return document;
  }

  querySelector(selector: "form"): ChatBrowserForm | null;
  querySelector(selector: "textarea"): ChatBrowserTextArea | null;
  querySelector(selector: "input"): ChatBrowserAttachmentInput | null;
  querySelector(selector: "form" | "textarea" | "input"): ChatBrowserForm | ChatBrowserTextArea | ChatBrowserAttachmentInput | null {
    if (selector === "form") return this.element.querySelector("form") as ChatBrowserForm | null;
    if (selector === "textarea") return this.element.querySelector("textarea") as ChatBrowserTextArea | null;
    const input = this.element.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) return null;
    return {
      async files() {
        return Promise.all([...input.files ?? []].map(async (file) => ({
          mimeType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })));
      },
    };
  }

  querySelectorAll(selector: "[data-retry-message-id]"): readonly ChatBrowserRetryButton[] {
    void selector;
    return [...this.element.querySelectorAll<HTMLButtonElement>("[data-retry-message-id]")];
  }
}
