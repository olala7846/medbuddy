import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("managed Firestore passive lineage index", () => {
  it("matches the sourceEvents target equality plus descending sequence query", async () => {
    const terraform = await readFile(new URL("../../../infra/terraform/prototype/foundation.tf", import.meta.url), "utf8");
    const resource = terraform.match(
      /resource "google_firestore_index" "passive_text_lineage" \{(?<body>[\s\S]*?)(?=\nresource |$)/u,
    )?.groups?.body;
    expect(resource).toBeDefined();
    expect(resource).toContain('collection  = "sourceEvents"');
    expect(resource).toContain('query_scope = "COLLECTION"');
    expect(resource).toMatch(/field_path = "payload\.targetMessageId"\s+order\s+= "ASCENDING"/u);
    expect(resource).toMatch(/field_path = "sourceSequence"\s+order\s+= "DESCENDING"/u);
  });
});
