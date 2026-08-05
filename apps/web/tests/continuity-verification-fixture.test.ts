import { describe, expect, it } from "vitest";

import {
  loadSyntheticContinuityFixture,
  parseSyntheticContinuityJsonl,
  SYNTHETIC_CONTINUITY_FIXTURE_URL,
  SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
} from "./support/continuity-verification-fixture.js";

describe("synthetic continuity JSONL fixture", () => {
  it("loads the committed provider-shaped sequence and substitutes only the run nonce", async () => {
    const steps = await loadSyntheticContinuityFixture(
      SYNTHETIC_CONTINUITY_FIXTURE_URL,
      "fixture-test",
    );
    expect(steps.map((step) => step.action)).toEqual([
      "SEND",
      "SEND",
      "SEND",
      "SEND",
      "SEND",
      "SEND",
      "REPLAY_CONCURRENT",
      "DRAIN",
      "SEND",
      "SEND",
    ]);
    expect(JSON.stringify(steps)).not.toContain("{{RUN_NONCE}}");
    expect(JSON.stringify(steps)).toContain("fictional-primary-fixture-test");
  });

  it("loads a separate fictional Traditional Chinese conversation", async () => {
    const steps = await loadSyntheticContinuityFixture(
      SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
      "fixture-zh-tw",
    );
    expect(steps.map((step) => step.action)).toEqual([
      "SEND",
      "SEND",
      "SEND",
      "SEND",
      "SEND",
      "SEND",
      "REPLAY_CONCURRENT",
      "DRAIN",
      "SEND",
      "SEND",
    ]);
    expect(JSON.stringify(steps)).toContain("這是完全虛構的繁體中文連續性驗證");
    expect(JSON.stringify(steps)).toContain("最新的虛構安排是什麼？");
    expect(JSON.stringify(steps)).toContain("fictional-primary-fixture-zh-tw");
  });

  it("rejects unknown actions, duplicate step IDs and references, and unknown placeholders", () => {
    const send = JSON.stringify({
      step: "one",
      action: "SEND",
      event: {
        type: "message",
        mode: "active",
        timestamp: 1,
        webhookEventId: "fictional-event",
        replyToken: "fictional-reply",
        source: { type: "group", groupId: "fictional-{{RUN_NONCE}}", userId: "fictional-sender" },
        message: { id: "fictional-message", type: "text", text: "Fictional text." },
      },
    });
    expect(() => parseSyntheticContinuityJsonl(`${send}\n${send}`, "run-a")).toThrow(/duplicate step/i);
    expect(() => parseSyntheticContinuityJsonl(`${send}\n${JSON.stringify({ step: "bad", action: "UNKNOWN" })}`, "run-a"))
      .toThrow();
    expect(() => parseSyntheticContinuityJsonl(send.replace("{{RUN_NONCE}}", "{{OTHER}}"), "run-a"))
      .toThrow(/placeholder/i);
    const replay = JSON.stringify({ step: "replay-a", action: "REPLAY_CONCURRENT", targetStep: "one", copies: 2 });
    const replayAgain = JSON.stringify({ step: "replay-b", action: "REPLAY_CONCURRENT", targetStep: "one", copies: 2 });
    expect(() => parseSyntheticContinuityJsonl(`${send}\n${replay}\n${replayAgain}`, "run-a"))
      .toThrow(/duplicate step reference/i);
  });
});
