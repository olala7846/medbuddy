import {
  ActorContextSchema,
  MemberIdSchema,
  type AccountId,
  type ActorContext,
  type DemoWorkspaceProvisioner,
  type MemberId,
  type WorkspaceId,
} from "@medbuddy/contracts";

import type { CredentialSession } from "./credentials.js";
import type { GoogleReviewerSession } from "./google.js";

export type AuthenticatedSession = CredentialSession | GoogleReviewerSession;

export interface ActorResolutionRequest {
  session?: AuthenticatedSession;
  workspaceId: WorkspaceId;
  demoMemberHeader?: string;
}

export interface SeededMemberDirectory {
  belongsToWorkspace(memberId: MemberId, workspaceId: WorkspaceId): Promise<boolean>;
}

export interface AuthResolutionDependencies {
  provisioner: DemoWorkspaceProvisioner;
  seededMembers: SeededMemberDirectory;
}

export class ActorResolutionError extends Error {
  constructor(readonly code: "NOT_AUTHENTICATED" | "NOT_AUTHORIZED") {
    super(code === "NOT_AUTHENTICATED" ? "Authentication is required." : "This account cannot access the requested workspace.");
  }
}

function requireSeededMember(value: string | undefined): MemberId {
  const memberId = MemberIdSchema.safeParse(value);
  if (!memberId.success) throw new ActorResolutionError("NOT_AUTHORIZED");
  return memberId.data;
}

function parseActor(
  accountId: AccountId,
  authentication: ActorContext["authentication"],
  effectiveMemberId: MemberId,
  workspaceId: WorkspaceId,
): ActorContext {
  return ActorContextSchema.parse({ accountId, authentication, effectiveMemberId, workspaceId });
}

/** Resolves a server-loaded session before any chat or domain service is called. */
export async function resolveActor(
  request: ActorResolutionRequest,
  dependencies: AuthResolutionDependencies,
): Promise<ActorContext> {
  if (!request.session) throw new ActorResolutionError("NOT_AUTHENTICATED");

  if (request.session.kind === "CREDENTIALS") {
    if (!(await dependencies.seededMembers.belongsToWorkspace(request.session.fixedMemberId, request.workspaceId))) {
      throw new ActorResolutionError("NOT_AUTHORIZED");
    }
    return parseActor(
      request.session.accountId,
      request.session,
      request.session.fixedMemberId,
      request.workspaceId,
    );
  }

  const mapping = await dependencies.provisioner.getOrCreate(request.session.accountId);
  if (mapping.workspaceId !== request.workspaceId) throw new ActorResolutionError("NOT_AUTHORIZED");
  const assumedMemberId = requireSeededMember(request.demoMemberHeader);
  if (!(await dependencies.seededMembers.belongsToWorkspace(assumedMemberId, mapping.workspaceId))) {
    throw new ActorResolutionError("NOT_AUTHORIZED");
  }
  return parseActor(
    request.session.accountId,
    { ...request.session, emailVerified: true, assumedMemberId },
    assumedMemberId,
    mapping.workspaceId,
  );
}
