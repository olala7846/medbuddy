import type { AccountId, DemoWorkspaceMapping, DemoWorkspaceProvisioner } from "@medbuddy/contracts";

export interface GoogleIdentity {
  accountId: AccountId;
  email: string;
  emailVerified: boolean;
}

export interface GoogleReviewerSession {
  kind: "GOOGLE_PROTOTYPE_REVIEWER";
  accountId: AccountId;
  email: string;
}

export interface GoogleAllowlist {
  allowedEmails: readonly string[];
  allowedDomains: readonly string[];
}

export interface AuthenticatedGoogleReviewer {
  session: GoogleReviewerSession;
  workspace: DemoWorkspaceMapping;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isAllowedEmail(email: string, allowlist: GoogleAllowlist): boolean {
  const normalizedEmail = normalizeEmail(email);
  const [, domain] = normalizedEmail.split("@");
  return (
    allowlist.allowedEmails.some((allowedEmail) => normalizeEmail(allowedEmail) === normalizedEmail) ||
    (domain !== undefined &&
      allowlist.allowedDomains.some((allowedDomain) => normalizeEmail(allowedDomain) === domain))
  );
}

/**
 * This accepts only the already-validated identity returned by the Google
 * provider boundary. It never treats a browser-provided email as verified.
 */
export async function authenticateGoogleReviewer(
  identity: GoogleIdentity,
  allowlist: GoogleAllowlist,
  provisioner: DemoWorkspaceProvisioner,
): Promise<AuthenticatedGoogleReviewer | null> {
  if (!identity.emailVerified || !isAllowedEmail(identity.email, allowlist)) return null;

  const workspace = await provisioner.getOrCreate(identity.accountId);
  return {
    session: {
      kind: "GOOGLE_PROTOTYPE_REVIEWER",
      accountId: identity.accountId,
      email: normalizeEmail(identity.email),
    },
    workspace,
  };
}
