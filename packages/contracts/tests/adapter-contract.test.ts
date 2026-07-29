import {
  describeAttachmentRepositoryContract,
  describeCaptureDispatcherContract,
  describeCareRecordRepositoryContract,
  describeMemberRepositoryContract,
  describeMessageRepositoryContract,
  describeWorkspaceRepositoryContract,
} from "./adapter-contract.js";
import type { CaptureJobInput } from "../src/capture.js";

describeWorkspaceRepositoryContract(() => {
  const workspaces = new Map();
  return {
    async getWorkspace(id) {
      return workspaces.get(id) ?? null;
    },
    async putWorkspace(workspace) {
      workspaces.set(workspace.id, workspace);
    },
  };
});

describeMemberRepositoryContract(() => {
  const members = new Map();
  return {
    async listMembers(workspaceId) {
      return [...members.values()].filter((member) => member.workspaceId === workspaceId);
    },
    async putMember(member) {
      members.set(member.id, member);
    },
  };
});

describeMessageRepositoryContract(() => {
  const messages = new Map();
  return {
    async getMessage(workspaceId, messageId) {
      return messages.get(`${workspaceId}:${messageId}`) ?? null;
    },
    async listMessages(workspaceId) {
      return [...messages.values()].filter((message) => message.workspaceId === workspaceId);
    },
    async putMessage(message) {
      const revision = Math.max(
        0,
        ...[...messages.values()]
          .filter((storedMessage) => storedMessage.workspaceId === message.workspaceId)
          .map((storedMessage) => storedMessage.revision),
      ) + 1;
      const storedMessage = { ...message, revision };
      messages.set(`${message.workspaceId}:${message.id}`, storedMessage);
      return storedMessage;
    },
  };
});

describeAttachmentRepositoryContract(() => {
  const attachments = new Map();
  return {
    async getAttachment(workspaceId, messageId, attachmentId) {
      return attachments.get(`${workspaceId}:${messageId}:${attachmentId}`) ?? null;
    },
    async putAttachment(attachment) {
      attachments.set(
        `${attachment.workspaceId}:${attachment.messageId}:${attachment.id}`,
        attachment,
      );
    },
  };
});

describeCareRecordRepositoryContract(() => {
  const facts = new Map();
  const reviews = new Map();
  const handoffs = new Map();
  return {
    async getFact(workspaceId, factId) {
      return facts.get(`${workspaceId}:${factId}`) ?? null;
    },
    async putFact(fact) {
      facts.set(`${fact.workspaceId}:${fact.id}`, fact);
    },
    async updateFactReviewStatus({ workspaceId, factId, reviewStatus }) {
      const fact = facts.get(`${workspaceId}:${factId}`);
      if (fact) facts.set(`${workspaceId}:${factId}`, { ...fact, reviewStatus });
    },
    async applyReview(review, reviewStatus) {
      reviews.set(review.id, review);
      const fact = facts.get(`${review.workspaceId}:${review.factId}`);
      if (fact) facts.set(`${review.workspaceId}:${review.factId}`, { ...fact, reviewStatus });
    },
    async listReviewEvents(workspaceId, factId) {
      return [...reviews.values()].filter(
        (review) => review.workspaceId === workspaceId && review.factId === factId,
      );
    },
    async appendReviewEvent(review) {
      reviews.set(review.id, review);
    },
    async getHandoff(workspaceId, handoffVersionId) {
      return handoffs.get(`${workspaceId}:${handoffVersionId}`) ?? null;
    },
    async createHandoff(handoff) {
      handoffs.set(`${handoff.workspaceId}:${handoff.id}`, handoff);
    },
  };
});

describeCaptureDispatcherContract(() => {
  const inputs: CaptureJobInput[] = [];
  return {
    dispatcher: {
      async dispatch(input) {
        inputs.push(input);
      },
    },
    dispatchedInputs() {
      return inputs;
    },
  };
});
