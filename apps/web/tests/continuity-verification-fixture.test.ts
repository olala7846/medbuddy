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

  it("loads a realistic multi-day Traditional Chinese family-health conversation", async () => {
    const steps = await loadSyntheticContinuityFixture(
      SYNTHETIC_CONTINUITY_TRADITIONAL_CHINESE_FIXTURE_URL,
      "fixture-zh-tw",
    );
    const sends = steps.filter((step) => step.action === "SEND");
    const primary = sends.filter((step) => step.event.source.groupId.includes("fictional-primary"));
    const messages = primary.map((step) => step.event.message.text);
    const conversation = messages.join("\n");

    expect(primary.length).toBeGreaterThanOrEqual(30);
    expect(new Set(primary.map((step) => step.event.source.userId))).toEqual(new Set([
      "fictional-ginnosuke",
      "fictional-tsuru",
      "fictional-hiroshi",
      "fictional-misae",
      "fictional-shinnosuke",
      "fictional-himawari",
    ]));
    expect(new Set(primary.map((step) => new Date(step.event.timestamp).toISOString().slice(0, 10))).size)
      .toBeGreaterThanOrEqual(9);
    expect(primary.map((step) => step.event.timestamp)).toEqual(
      [...primary].map((step) => step.event.timestamp).sort((left, right) => left - right),
    );

    for (const relationship of [
      "野原鶴是我的太太",
      "銀之介是我的先生",
      "銀之介和野原鶴是我的父母",
      "廣志是我的先生",
      "廣志和美冴是我的爸爸媽媽",
      "銀之介和野原鶴是我的爺爺奶奶",
    ]) expect(conversation).toContain(relationship);
    expect(conversation).toContain("第一次回診");
    expect(conversation).toContain("今天由我陪爸爸看診");
    expect(conversation).toContain("第二次回診");
    expect(conversation).toContain("今天由我陪公公看診");
    expect(conversation).toContain("早上的藥");
    expect(conversation).toContain("頭暈");
    expect(conversation).toContain("昨晚睡得不好");
    expect(conversation).toContain("剛才那筆血壓我輸入錯了");
    expect(conversation).toContain("更正後是 125/78");

    expect(steps.filter((step) => step.action === "REPLAY_CONCURRENT")).toHaveLength(1);
    expect(steps.filter((step) => step.action === "DRAIN")).toHaveLength(2);
    expect(primary.filter((step) => step.event.message.mention !== undefined)).toHaveLength(2);
    expect(primary.map((step) => step.step)).toEqual(expect.arrayContaining([
      "below-trigger-two",
      "bootstrap-trigger",
      "trigger",
      "pending-message",
      "mentioned-focal",
      "newer-correction",
      "final-mentioned-question",
    ]));

    for (const message of messages) {
      const sentences = message.split(/[。！？]/u).map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 8);
      expect(new Set(sentences).size, message).toBe(sentences.length);
    }
    expect(JSON.stringify(steps)).not.toContain("{{RUN_NONCE}}");
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
