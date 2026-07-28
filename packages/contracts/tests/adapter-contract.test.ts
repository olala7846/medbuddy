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
    async getMessage(_workspaceId, messageId) {
      return messages.get(messageId) ?? null;
    },
    async putMessage(message) {
      messages.set(message.id, message);
    },
  };
});

describeAttachmentRepositoryContract(() => {
  const attachments = new Map();
  return {
    async getAttachment(_workspaceId, _messageId, attachmentId) {
      return attachments.get(attachmentId) ?? null;
    },
    async putAttachment(attachment) {
      attachments.set(attachment.id, attachment);
    },
  };
});

describeCareRecordRepositoryContract(() => {
  const facts = new Map();
  const reviews = new Map();
  const handoffs = new Map();
  return {
    async getFact(_workspaceId, factId) {
      return facts.get(factId) ?? null;
    },
    async putFact(fact) {
      facts.set(fact.id, fact);
    },
    async listReviewEvents(_workspaceId, factId) {
      return [...reviews.values()].filter((review) => review.factId === factId);
    },
    async appendReviewEvent(review) {
      reviews.set(review.id, review);
    },
    async getHandoff(_workspaceId, handoffVersionId) {
      return handoffs.get(handoffVersionId) ?? null;
    },
    async createHandoff(handoff) {
      handoffs.set(handoff.id, handoff);
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
