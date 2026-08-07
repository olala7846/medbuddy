import { defineConfig } from "vitest/config";

/**
 * One executable gate for Effort 3.7. The integration tracer proves the whole
 * user path; the focused files retain ownership of the edge-case contracts so
 * this gate does not copy their unit assertions into another harness.
 */
export default defineConfig({
  test: {
    include: [
      "apps/web/tests/memory-acceptance.test.ts",
      "apps/web/tests/memory-tracer.test.ts",
      "apps/web/tests/line-webhook.test.ts",
      "apps/web/tests/passive-memory-direct-proof.test.ts",
      "apps/web/tests/passive-memory-worker.test.ts",
      "apps/web/tests/memory-formation-direct-proof.test.ts",
      "apps/web/tests/memory-formation-route.test.ts",
      "apps/web/tests/composition/production-composition.test.ts",
      "packages/chat/tests/dynamic-memory.test.ts",
      "packages/chat/tests/memory-formation-scheduler.test.ts",
      "packages/chat/tests/conversation-continuity.test.ts",
      "packages/chat/tests/external-conversation.test.ts",
      "packages/contracts/tests/dynamic-memory.test.ts",
      "packages/contracts/tests/memory-formation.test.ts",
      "packages/contracts/tests/passive-memory.test.ts",
      "packages/intelligence/tests/conversation.test.ts",
      "packages/intelligence/tests/injection.test.ts",
      "packages/intelligence/tests/medication-refusal.test.ts",
      "packages/intelligence/tests/passive-memory.test.ts",
      "packages/platform/tests/dynamic-memory-in-memory.test.ts",
      "packages/platform/tests/dynamic-memory-firestore.test.ts",
      "packages/platform/tests/memory-formation-in-memory.test.ts",
      "packages/platform/tests/memory-source-freshness-in-memory.test.ts",
      "packages/platform/tests/passive-memory-in-memory.test.ts",
      "packages/platform/tests/passive-memory-firestore.test.ts",
      "packages/platform/tests/workspace-family-map.test.ts",
    ],
    passWithNoTests: false,
  },
});
