export interface VerifiedTaskIdentity {
  email?: string;
  email_verified?: boolean;
  aud?: string | string[];
}

export interface TaskTokenVerifier {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<{ getPayload(): VerifiedTaskIdentity | undefined }>;
}

/** Uses Google's verified ID-token audience check before local identity checks. */
export class GoogleTaskTokenVerifier implements TaskTokenVerifier {
  constructor(private readonly client = new OAuth2Client()) {}

  async verifyIdToken(input: { idToken: string; audience: string }) {
    return this.client.verifyIdToken(input);
  }
}

export function taskAuthorizationToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer (.+)$/);
  if (!match?.[1]) {
    throw new Error("Cloud Tasks callback requires a bearer token.");
  }
  return match[1];
}

export async function verifyTaskCallback(input: {
  authorization: string | undefined;
  audience: string;
  serviceAccountEmail: string;
  verifier: TaskTokenVerifier;
}): Promise<void> {
  const payload = (await input.verifier.verifyIdToken({
    idToken: taskAuthorizationToken(input.authorization),
    audience: input.audience,
  })).getPayload();
  if (payload?.email !== input.serviceAccountEmail || payload.email_verified !== true) {
    throw new Error("Cloud Tasks callback identity is not authorized.");
  }
}
import { OAuth2Client } from "google-auth-library";
