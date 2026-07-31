import { randomUUID } from "node:crypto";

import { ChatService } from "@medbuddy/chat";
import {
  AccountIdSchema,
  HandoffVersionIdSchema,
  MemberIdSchema,
  MessageWriteSchema,
  type HandoffVersion,
  type MemberDocument,
  type MessageId,
  type WorkspaceId,
} from "@medbuddy/contracts";
import { InMemoryDemoWorkspacePersistence } from "@medbuddy/platform";

import { createAuthenticatedChatRoute } from "../authenticated-chat-route.js";
import { createServerAttachmentAdmission } from "../attachment-admission.server.js";
import {
  authenticateGoogleReviewer,
  createSeededCredentialAuthenticator,
  hashCredentialPassword,
  resolveActor,
  type AuthenticatedSession,
} from "../auth/index.js";
import {
  CREDENTIAL_TEST_WORKSPACE_ID,
  FictionalDemoWorkspaceProvisioner,
  seedCredentialTestWorkspace,
} from "../composition/demo-workspace.js";

const REVIEWER_ACCOUNT_ID = AccountIdSchema.parse("account:local-reviewer");
const REVIEWER_EMAIL = "local-reviewer@example.test";
const CREDENTIAL_ACCOUNT_ID = AccountIdSchema.parse("account:local-credential-owner");

export const LOCAL_CREDENTIAL_USERNAME = "fictional-owner";
export const LOCAL_CREDENTIAL_PASSWORD = "fictional-password";

interface StoredSession {
  session: AuthenticatedSession;
  workspaceId: WorkspaceId;
}

export interface LocalSignInResult extends StoredSession {
  token: string;
  members: readonly MemberDocument[];
}

export interface LocalDemoHostOptions {
  processingDelayMs?: number;
}

export async function createLocalDemoHost(options: LocalDemoHostOptions = {}) {
  const demoStorage = new InMemoryDemoWorkspacePersistence();
  const persistence = demoStorage.persistence;
  const provisioner = new FictionalDemoWorkspaceProvisioner(demoStorage);
  const sessions = new Map<string, StoredSession>();
  const processingDelayMs = options.processingDelayMs ?? 350;
  await seedCredentialTestWorkspace(demoStorage);

  const credentialAuthenticator = createSeededCredentialAuthenticator([{
    username: LOCAL_CREDENTIAL_USERNAME,
    accountId: CREDENTIAL_ACCOUNT_ID,
    fixedMemberId: MemberIdSchema.parse("member:owner"),
    passwordHash: await hashCredentialPassword(LOCAL_CREDENTIAL_PASSWORD),
  }]);

  const seededMembers = {
    async belongsToWorkspace(memberId: MemberDocument["id"], workspaceId: WorkspaceId) {
      return (await persistence.members.listMembers(workspaceId)).some((member) => member.id === memberId);
    },
  };

  const updateProcessingStatus = async (messageId: MessageId) => {
    const sessionWorkspaces = new Set([...sessions.values()].map((entry) => entry.workspaceId));
    sessionWorkspaces.add(CREDENTIAL_TEST_WORKSPACE_ID);
    for (const workspaceId of sessionWorkspaces) {
      const message = await persistence.messages.getMessage(workspaceId, messageId);
      if (!message) continue;
      const attempt = message.processingAttempts + 1;
      await persistence.messages.putMessage({
        ...MessageWriteSchema.parse(message),
        processingStatus: "PROCESSING",
        processingAttempts: attempt,
        lastProcessingErrorCode: undefined,
      });
      setTimeout(() => {
        void (async () => {
          const processing = await persistence.messages.getMessage(workspaceId, messageId);
          if (!processing) return;
          const isFirstFailure = processing.body.includes("[demo:fail-once]") && attempt === 1;
          const processingStatus = isFirstFailure
            ? "FAILED"
            : processing.body.includes("[demo:ignore]")
              ? "IGNORED"
              : processing.body.includes("[demo:manual-review]")
                ? "NEEDS_MANUAL_REVIEW"
                : "CAPTURED";
          await persistence.messages.putMessage({
            ...MessageWriteSchema.parse(processing),
            processingStatus,
            processingAttempts: attempt,
            ...(isFirstFailure ? { lastProcessingErrorCode: "PROVIDER_TIMEOUT" } : {}),
          });
        })();
      }, processingDelayMs);
      return;
    }
  };

  const chatService = new ChatService({
    workspaces: persistence.workspaces,
    members: persistence.members,
    messages: persistence.messages,
    captureDispatcher: {
      async dispatch({ messageId }) {
        setTimeout(() => { void updateProcessingStatus(messageId); }, processingDelayMs);
      },
    },
    responder: {
      async respond() {
        return {
          kind: "RESPONDED",
          retryable: false,
          responseText: "Thanks for sharing. I can help organize this fictional report for review, but I cannot make medical decisions.",
        };
      },
    },
  });
  const attachmentAdmission = createServerAttachmentAdmission({
    attachmentRepository: persistence.attachments,
  });

  async function saveSession(entry: StoredSession): Promise<LocalSignInResult> {
    const token = randomUUID();
    sessions.set(token, entry);
    return {
      ...entry,
      token,
      members: await persistence.members.listMembers(entry.workspaceId),
    };
  }

  function requireSession(token: string): StoredSession {
    const entry = sessions.get(token);
    if (!entry) throw new Error("Authentication is required.");
    return entry;
  }

  async function resolveSessionActor(
    token: string,
    workspaceId: WorkspaceId,
    demoMemberHeader?: string,
  ) {
    return resolveActor(
      {
        session: requireSession(token).session,
        workspaceId,
        ...(demoMemberHeader === undefined ? {} : { demoMemberHeader }),
      },
      { provisioner, seededMembers },
    );
  }

  function chatApi(token: string) {
    requireSession(token);
    return createAuthenticatedChatRoute({
      chatService,
      attachmentAdmission,
      resolveServerActor: (workspaceId, demoMemberHeader) =>
        resolveSessionActor(token, workspaceId, demoMemberHeader),
    });
  }

  return {
    async signInReviewer(): Promise<LocalSignInResult> {
      const authenticated = await authenticateGoogleReviewer(
        { accountId: REVIEWER_ACCOUNT_ID, email: REVIEWER_EMAIL, emailVerified: true },
        { allowedEmails: [REVIEWER_EMAIL], allowedDomains: [] },
        provisioner,
      );
      if (!authenticated) throw new Error("Local reviewer authentication failed.");
      return saveSession({ session: authenticated.session, workspaceId: authenticated.workspace.workspaceId });
    },
    async signInWithCredentials(username: string, password: string): Promise<LocalSignInResult | null> {
      const session = await credentialAuthenticator(username, password);
      return session === null ? null : saveSession({ session, workspaceId: CREDENTIAL_TEST_WORKSPACE_ID });
    },
    getSession(token: string): StoredSession & { members: readonly MemberDocument[] } {
      const entry = requireSession(token);
      return {
        ...entry,
        members: [],
      };
    },
    async sessionDetails(token: string): Promise<StoredSession & { members: readonly MemberDocument[] }> {
      const entry = requireSession(token);
      return { ...entry, members: await persistence.members.listMembers(entry.workspaceId) };
    },
    signOut(token: string): void {
      sessions.delete(token);
    },
    chatApi,
    async review(token: string, workspaceId: WorkspaceId, headers: Readonly<Record<string, string>>) {
      await resolveSessionActor(token, workspaceId, headers["X-MedBuddy-Demo-Member"]);
      const handoff = await persistence.careRecords.getHandoff(workspaceId, HandoffVersionIdSchema.parse("handoff:v2"));
      if (!handoff) throw new Error("Review fixture was not found.");
      return { facts: handoff.snapshot.facts, conflicts: handoff.snapshot.conflicts, allowedReviewActions: [] as const };
    },
    async handoff(
      token: string,
      workspaceId: WorkspaceId,
      version: number,
      headers: Readonly<Record<string, string>>,
    ): Promise<HandoffVersion> {
      await resolveSessionActor(token, workspaceId, headers["X-MedBuddy-Demo-Member"]);
      const handoff = await persistence.careRecords.getHandoff(
        workspaceId,
        HandoffVersionIdSchema.parse(`handoff:v${version}`),
      );
      if (!handoff) throw new Error("Handoff was not found.");
      return handoff;
    },
  };
}

export type LocalDemoHost = Awaited<ReturnType<typeof createLocalDemoHost>>;
