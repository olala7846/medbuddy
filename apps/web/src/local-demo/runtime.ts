import type { LocalDemoHost } from "./host.js";
import { createLocalDemoHost } from "./host.js";

const runtimeKey = Symbol.for("medbuddy.localDemoHost");
type RuntimeGlobal = typeof globalThis & { [runtimeKey]?: Promise<LocalDemoHost> };
const runtime = globalThis as RuntimeGlobal;

export function getLocalDemoHost(): Promise<LocalDemoHost> {
  runtime[runtimeKey] ??= createLocalDemoHost();
  return runtime[runtimeKey];
}
