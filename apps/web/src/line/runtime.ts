import { createLineWebhookComposition } from "../composition/line.js";
import type { LineWebhookLogEntry, LineWebhookLogger } from "./webhook.js";

export const productionLineWebhookLogger: LineWebhookLogger = {
  write(entry: LineWebhookLogEntry) {
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  },
};

const runtimeKey = Symbol.for("medbuddy.lineWebhookHandler");
type RuntimeGlobal = typeof globalThis & {
  [runtimeKey]?: ReturnType<typeof createLineWebhookComposition>;
};
const runtime = globalThis as RuntimeGlobal;

export function getLineWebhookHandler() {
  runtime[runtimeKey] ??= createLineWebhookComposition(process.env, {
    logger: productionLineWebhookLogger,
  });
  return runtime[runtimeKey];
}
