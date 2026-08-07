import { defineConfig } from "vitest/config";

const inMemoryOnly = process.env.MEDBUDDY_MEMORY_ACCEPTANCE_IN_MEMORY_ONLY === "true";
if (!inMemoryOnly && (process.env.FIRESTORE_EMULATOR_HOST?.trim().length ?? 0) === 0) {
  throw new Error(
    "The dynamic-memory acceptance gate requires a fresh local Firestore emulator. " +
    "Use verify:memory:acceptance:memory only for the explicitly in-memory subset.",
  );
}

const firestoreContracts = [
  "packages/platform/tests/continuity-firestore.test.ts",
  "packages/platform/tests/dynamic-memory-firestore.test.ts",
  "packages/platform/tests/firestore-emulator.test.ts",
  "packages/platform/tests/passive-memory-firestore.test.ts",
];

/**
 * One executable gate for Effort 3.7. The integration tracer proves the whole
 * user path; the focused files retain ownership of the edge-case contracts so
 * this gate does not copy their unit assertions into another harness.
 */
export default defineConfig({
  test: {
    include: [
      "apps/web/tests/memory-acceptance.test.ts",
      "apps/web/tests/memory-acceptance-fixture.test.ts",
      "apps/web/tests/memory-tracer.test.ts",
      "apps/web/tests/line-webhook.test.ts",
      "apps/web/tests/passive-memory-direct-proof.test.ts",
      "apps/web/tests/passive-memory-worker.test.ts",
      "apps/web/tests/memory-formation-direct-proof.test.ts",
      "apps/web/tests/memory-formation-route.test.ts",
      "apps/web/tests/composition/production-composition.test.ts",
      "apps/web/tests/continuity-verification-memory.test.ts",
      "packages/chat/tests/dynamic-memory.test.ts",
      "packages/chat/tests/memory-formation-scheduler.test.ts",
      "packages/chat/tests/conversation-continuity.test.ts",
      "packages/chat/tests/external-conversation.test.ts",
      "packages/contracts/tests/dynamic-memory.test.ts",
      "packages/contracts/tests/memory-formation.test.ts",
      "packages/contracts/tests/passive-memory.test.ts",
      "packages/contracts/tests/workspace-family-map.test.ts",
      "packages/intelligence/tests/conversation.test.ts",
      "packages/intelligence/tests/injection.test.ts",
      "packages/intelligence/tests/medication-refusal.test.ts",
      "packages/intelligence/tests/passive-memory.test.ts",
      "packages/intelligence/tests/tool-dispatcher.test.ts",
      "packages/intelligence/tests/vertex-adapter.test.ts",
      "packages/platform/tests/dynamic-memory-in-memory.test.ts",
      "packages/platform/tests/continuity-in-memory.test.ts",
      "packages/platform/tests/in-memory.test.ts",
      "packages/platform/tests/memory-formation-in-memory.test.ts",
      "packages/platform/tests/memory-source-freshness-in-memory.test.ts",
      "packages/platform/tests/passive-memory-in-memory.test.ts",
      "packages/platform/tests/workspace-family-map.test.ts",
      ...(inMemoryOnly ? [] : firestoreContracts),
    ],
    passWithNoTests: false,
  },
});
