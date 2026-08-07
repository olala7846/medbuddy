import {
  ContinuityThreadConversationService,
  DynamicMemoryService,
  MemoryFormationScheduler,
  ThreadConversationService,
} from "@medbuddy/chat";
import {
  MEMORY_FORMATION_POLICIES,
  type ContinuityRepository,
  type DynamicMemoryRepository,
  type ExternalEventReceiptStore,
  type MemoryFormationRepository,
  type MessageRepository,
  type PassiveMemoryJobRepository,
  type PassiveMemorySourceLedger,
  type PassiveMemoryTaskInput,
  type WorkspaceFamilyMapRepository,
} from "@medbuddy/contracts";
import {
  ConversationResponder,
  FixedConversationProvider,
  MEDICATION_DECISION_REFUSAL_TEXT,
  createFixtureMedicationGrounding,
} from "@medbuddy/intelligence";
import { PassiveMemoryEvidenceReaderAdapter } from "@medbuddy/platform";

import { PassiveMemoryWorker } from "../../src/composition/passive-memory.js";
import {
  LineWebhookHandler,
  createLineSignature,
  deriveLineConversationIds,
  type LineOperationalLogEntry,
} from "../../src/line/index.js";
import {
  SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL,
  loadSyntheticContinuityFixture,
  type SyntheticContinuitySendStep,
} from "./continuity-verification-fixture.js";
import {
  syntheticContinuityCleanupManifest,
  type SyntheticContinuityCleanupManifest,
} from "./continuity-verification-harness.js";

const CHANNEL_SECRET = "fictional-deployed-memory-smoke-secret";

type SmokeDependencies = {
  continuity: ContinuityRepository & MemoryFormationRepository & PassiveMemorySourceLedger;
  messages: MessageRepository;
  familyMaps: WorkspaceFamilyMapRepository;
  receipts: ExternalEventReceiptStore;
  memory: DynamicMemoryRepository;
  jobs: PassiveMemoryJobRepository;
};

export type SyntheticDeployedMemorySmokeResult = {
  cleanup: SyntheticContinuityCleanupManifest;
  observations: {
    passiveSourceReplyCount: number;
    attributedRecallCount: number;
    explicitAcknowledgementCount: number;
    primaryActiveMemoryCount: number;
    isolatedActiveMemoryCount: number;
    humanCanonicalSourceCount: number;
    operationalLogCount: number;
    medicationRefusalCount: number;
    postReplyEligibleMedBuddySourceCount: number;
  };
};

function requireCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function identity(step: SyntheticContinuitySendStep) {
  return {
    channel: "LINE" as const,
    conversationType: "GROUP" as const,
    conversationId: step.event.source.groupId,
    senderId: step.event.source.userId,
    messageId: step.event.message.id,
    eventId: step.event.webhookEventId,
  };
}

function signed(step: SyntheticContinuitySendStep) {
  const rawBody = JSON.stringify({ destination: "fictional-deployed-memory-smoke-bot", events: [step.event] });
  return { rawBody, signature: createLineSignature(rawBody, CHANNEL_SECRET) };
}

function sendStep(steps: readonly SyntheticContinuitySendStep[], name: string): SyntheticContinuitySendStep {
  const step = steps.find((candidate) => candidate.step === name);
  if (step === undefined) throw new Error(`Synthetic deployed-memory smoke is missing step ${name}.`);
  return step;
}

export async function runSyntheticDeployedMemorySmoke(
  dependencies: SmokeDependencies,
  options: { runNonce: string },
): Promise<SyntheticDeployedMemorySmokeResult> {
  const parsed = await loadSyntheticContinuityFixture(
    SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL,
    options.runNonce,
  );
  const steps = parsed.filter((step): step is SyntheticContinuitySendStep => step.action === "SEND");
  requireCondition(steps.length === parsed.length && steps.length === 6, "Synthetic deployed-memory smoke scope changed.");
  const passiveSource = sendStep(steps, "passive-source");
  const passiveRecall = sendStep(steps, "passive-recall");
  const explicitRemember = sendStep(steps, "explicit-remember");
  const explicitRecall = sendStep(steps, "explicit-recall");
  const isolationQuery = sendStep(steps, "isolation-query");
  const medicationRefusal = sendStep(steps, "medication-refusal");
  const cleanup = await syntheticContinuityCleanupManifest(
    options.runNonce,
    SYNTHETIC_DEPLOYED_MEMORY_SMOKE_FIXTURE_URL,
  );
  const primaryIds = deriveLineConversationIds(identity(passiveRecall));
  const isolatedIds = deriveLineConversationIds(identity(isolationQuery));
  const passiveRecallIds = deriveLineConversationIds(identity(passiveRecall));
  const explicitRememberIds = deriveLineConversationIds(identity(explicitRemember));
  const explicitRecallIds = deriveLineConversationIds(identity(explicitRecall));
  const isolationQueryIds = deriveLineConversationIds(identity(isolationQuery));
  const medicationRefusalIds = deriveLineConversationIds(identity(medicationRefusal));
  const provider = new FixedConversationProvider(new Map([
    [passiveRecallIds.messageId, [
      { kind: "CALL_TOOL", name: "query_memory", input: {} },
      { kind: "REPLY", text: "書架上。來源：human conversation。信任：UNREVIEWED_DERIVED。" },
    ]],
    [explicitRememberIds.messageId, [{
      kind: "CALL_TOOL", name: "propose_memory", input: {
        payload: { memoryType: "SEMANTIC", statement: "虛構的預約資料夾是藍色的。", subjectLabels: [] },
        tags: [],
      },
    }]],
    [explicitRecallIds.messageId, [
      { kind: "CALL_TOOL", name: "query_memory", input: {} },
      { kind: "REPLY", text: "藍色。來源：human conversation。信任：UNREVIEWED_DERIVED。" },
    ]],
    [isolationQueryIds.messageId, [
      { kind: "CALL_TOOL", name: "query_memory", input: {} },
      { kind: "REPLY", text: "這個聊天室沒有相關的可用記憶。" },
    ]],
  ]));
  const dispatched: PassiveMemoryTaskInput[] = [];
  const wakeups: Array<Parameters<MemoryFormationScheduler["wake"]>[0] & { scheduleTime?: string }> = [];
  const replies: string[] = [];
  const logs: LineOperationalLogEntry[] = [];
  let generationCount = 0;
  let postReplyEligibleMedBuddySourceCount = -1;
  let now = new Date(passiveSource.event.timestamp + 1_000).toISOString();
  const scheduler = new MemoryFormationScheduler({
    repository: dependencies.continuity,
    jobs: dependencies.jobs,
    wakeDispatcher: { async dispatch(input) { wakeups.push(input); } },
    workerDispatcher: { async dispatch(input) { dispatched.push(input); } },
    policy: MEMORY_FORMATION_POLICIES.production,
    now: () => now,
  });
  const memoryService = new DynamicMemoryService(dependencies.memory, () => now, dependencies.continuity);
  const responder = new ConversationResponder(createFixtureMedicationGrounding(), provider);
  const handler = new LineWebhookHandler({
    channelSecret: CHANNEL_SECRET,
    receipts: dependencies.receipts,
    conversation: new ThreadConversationService({
      messages: dependencies.messages,
      familyMaps: dependencies.familyMaps,
      responder,
    }),
    continuityConversation: new ContinuityThreadConversationService({
      continuity: dependencies.continuity,
      messages: dependencies.messages,
      familyMaps: dependencies.familyMaps,
      memory: memoryService,
      responder,
      systemInstructions: "Preserve workspace isolation and deterministic medical safety.",
      formationScheduler: scheduler,
    }),
    replyClient: { async reply(input) { replies.push(input.text); } },
    logger: { write(entry) { logs.push(structuredClone(entry)); } },
  });
  const deliver = async (step: SyntheticContinuitySendStep) => {
    const result = await handler.handle({ ...signed(step), correlationId: `request:${step.step}` });
    requireCondition(result.status === 200, `Synthetic deployed-memory step ${step.step} failed.`);
  };

  await deliver(passiveSource);
  const passiveSourceReplyCount = replies.length;
  requireCondition(passiveSourceReplyCount === 0, "Passive source produced a reply.");
  requireCondition(wakeups.length === 1 && dispatched.length === 0, "Passive source did not schedule one quiet wake.");
  const scheduledFor = wakeups[0]?.scheduleTime;
  if (scheduledFor === undefined) throw new Error("Passive source wake has no schedule time.");
  now = new Date(Date.parse(scheduledFor) + 1).toISOString();
  const { scheduleTime: _scheduleTime, ...wake } = wakeups[0]!;
  void _scheduleTime;
  await scheduler.wake(wake, now);
  requireCondition(dispatched.length === 1, "Quiet wake did not dispatch one passive worker job.");
  const worker = new PassiveMemoryWorker({
    jobs: dependencies.jobs,
    evidence: new PassiveMemoryEvidenceReaderAdapter(dependencies.continuity),
    generator: { async generate(input) {
      generationCount += 1;
      if (generationCount > 1) {
        requireCondition(input.evidence.length > 0, "Post-reply formation received no eligible source.");
        postReplyEligibleMedBuddySourceCount = input.evidence.filter(
          (item) => item.authorMemberId === "MEDBUDDY",
        ).length;
        return { output: { proposals: [] } };
      }
      requireCondition(input.evidence.length === 1, "Passive worker received an unexpected source range.");
      return { output: { proposals: [{
        sourceRef: input.evidence[0]!.canonicalSourceRef,
        payload: { memoryType: "SEMANTIC", statement: "虛構的藍色資料夾放在書架上。", subjectLabels: [] },
        tags: [],
      }] } };
    } },
    memory: memoryService,
    now: () => now,
    logger: { write() {} },
  });
  requireCondition(await worker.run(dispatched[0]!) === "COMPLETED", "Passive worker did not complete.");

  for (const step of [passiveRecall, explicitRemember, explicitRecall, isolationQuery, medicationRefusal]) {
    await deliver(step);
  }
  for (let attempt = 0; attempt < 3 && dispatched.length < 2; attempt += 1) {
    const finalWakeup = wakeups.filter((wakeup) => wakeup.workspaceId === primaryIds.workspaceId).at(-1);
    if (finalWakeup === undefined) throw new Error("Post-reply formation has no quiet wake.");
    if (finalWakeup.scheduleTime === undefined) throw new Error("Post-reply quiet wake has no schedule time.");
    now = new Date(Date.parse(finalWakeup.scheduleTime) + 1).toISOString();
    const { scheduleTime: _finalScheduleTime, ...finalWake } = finalWakeup;
    void _finalScheduleTime;
    const outcome = await scheduler.wake(finalWake, now);
    requireCondition(
      outcome === "DISPATCHED" || outcome === "RESCHEDULED",
      `Post-reply primary wake returned ${outcome}.`,
    );
  }
  requireCondition(dispatched.length === 2, "Post-reply quiet wake did not dispatch one worker job.");
  requireCondition(await worker.run(dispatched[1]!) === "COMPLETED", "Post-reply worker did not complete.");
  requireCondition(postReplyEligibleMedBuddySourceCount === 0, "MedBuddy output became an eligible canonical source.");
  const primaryRecords = await dependencies.memory.listActive(primaryIds.workspaceId, 10);
  const isolatedRecords = await dependencies.memory.listActive(isolatedIds.workspaceId, 10);
  const humanCanonicalSourceCount = primaryRecords.filter((record) =>
    record.sourceClass === "HUMAN_CONVERSATION" &&
    record.trustClass === "UNREVIEWED_DERIVED" &&
    record.canonicalSource.authorMemberRef !== "MEDBUDDY").length;
  requireCondition(primaryRecords.length === 2, "Primary workspace did not retain exactly two memories.");
  requireCondition(isolatedRecords.length === 0, "Isolated workspace retrieved a primary memory.");
  requireCondition(humanCanonicalSourceCount === 2, "A memory was not bound to a human canonical source.");
  const queryRecords = (messageId: string) => {
    const continuation = provider.requests.find((request) =>
      request.focalMessage.id === messageId && request.toolResult !== undefined);
    const result = continuation?.toolResult as { result?: { evidence?: { records?: readonly unknown[] } } } | undefined;
    return result?.result?.evidence?.records ?? [];
  };
  requireCondition(queryRecords(passiveRecallIds.messageId).length === 1, "Passive recall did not return one record.");
  requireCondition(queryRecords(explicitRecallIds.messageId).length === 2, "Explicit recall did not return two records.");
  requireCondition(queryRecords(isolationQueryIds.messageId).length === 0, "Isolation query returned a record.");
  const attributedRecallCount = replies.filter((reply) =>
    reply.includes("human conversation") && reply.includes("UNREVIEWED_DERIVED")).length;
  const explicitAcknowledgementCount = replies.filter((reply) =>
    reply === "I remembered that for this chat as unreviewed evidence.").length;
  requireCondition(attributedRecallCount === 2, "Recall replies did not expose source and trust attribution.");
  requireCondition(explicitAcknowledgementCount === 1, "Explicit remember did not receive one truthful acknowledgment.");
  const medicationRefusalCount = replies.filter((reply) => reply === MEDICATION_DECISION_REFUSAL_TEXT).length;
  requireCondition(medicationRefusalCount === 1, "Medication decision did not receive the deterministic refusal.");
  requireCondition(
    !provider.requests.some((request) => request.focalMessage.id === medicationRefusalIds.messageId),
    "Medication decision reached the model provider.",
  );
  const forbiddenLogValues = [CHANNEL_SECRET, ...steps.flatMap((step) => [
    step.event.source.groupId,
    step.event.source.userId,
    step.event.message.id,
    step.event.webhookEventId,
    step.event.replyToken,
    step.event.message.text,
  ]), ...cleanup.workspaceIds,
  "Preserve workspace isolation and deterministic medical safety.",
  "書架上。來源：human conversation。信任：UNREVIEWED_DERIVED。",
  "虛構的預約資料夾是藍色的。",
  "藍色。來源：human conversation。信任：UNREVIEWED_DERIVED。",
  "這個聊天室沒有相關的可用記憶。",
  "I remembered that for this chat as unreviewed evidence.",
  "虛構的藍色資料夾放在書架上。",
  MEDICATION_DECISION_REFUSAL_TEXT,
  ];
  const serializedLogs = JSON.stringify(logs);
  requireCondition(forbiddenLogValues.every((value) => !serializedLogs.includes(value)), "Operational logs exposed smoke content or identifiers.");

  return {
    cleanup,
    observations: {
      passiveSourceReplyCount,
      attributedRecallCount,
      explicitAcknowledgementCount,
      primaryActiveMemoryCount: primaryRecords.length,
      isolatedActiveMemoryCount: isolatedRecords.length,
      humanCanonicalSourceCount,
      operationalLogCount: logs.length,
      medicationRefusalCount,
      postReplyEligibleMedBuddySourceCount,
    },
  };
}
