import { describe, expect, it } from "vitest";

import { LineOperationalLogEntrySchema } from "../src/line/index.js";

describe("content-free LINE telemetry", () => {
  it("accepts only bounded operational fields", () => {
    expect(LineOperationalLogEntrySchema.parse({
      event: "line_event_completed",
      correlationId: "request:fictional-safe-token",
      conversationType: "GROUP",
    })).toEqual({
      event: "line_event_completed",
      correlationId: "request:fictional-safe-token",
      conversationType: "GROUP",
    });
    expect(LineOperationalLogEntrySchema.parse({
      event: "family_map_updated",
      priorRevision: 0,
      resultingRevision: 1,
      characterCountClass: "SHORT",
      toolAttemptCount: 1,
      modelStepCount: 2,
    })).toMatchObject({ event: "family_map_updated" });
  });

  it.each(["body", "workspaceId", "prompt", "summary", "attachmentId", "objectPath", "replyToken"])(
    "rejects prohibited %s data",
    (field) => {
      expect(() => LineOperationalLogEntrySchema.parse({
        event: "line_event_completed",
        correlationId: "request:fictional-safe-token",
        [field]: "fictional-prohibited-value",
      })).toThrow();
    },
  );
});
