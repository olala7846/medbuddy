import {
  AccountIdSchema,
  MemberIdSchema,
  type AccountId,
  type MemberId,
} from "@medbuddy/contracts";

const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 210_000;
const PASSWORD_HASH_BYTES = 32;

export interface CredentialSeed {
  username: string;
  accountId: AccountId;
  fixedMemberId: MemberId;
  passwordHash: string;
}

export interface CredentialSession {
  kind: "CREDENTIALS";
  accountId: AccountId;
  fixedMemberId: MemberId;
}

interface ParsedPasswordHash {
  iterations: number;
  salt: Uint8Array;
  digest: Uint8Array;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function parsePasswordHash(value: string): ParsedPasswordHash | null {
  const [algorithm, iterationsText, saltText, digestText, ...unexpected] = value.split("$");
  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    unexpected.length > 0 ||
    iterationsText === undefined ||
    saltText === undefined ||
    digestText === undefined
  ) {
    return null;
  }

  const iterations = Number(iterationsText);
  const salt = base64ToBytes(saltText);
  const digest = base64ToBytes(digestText);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || !salt || !digest || digest.length !== PASSWORD_HASH_BYTES) {
    return null;
  }
  return { iterations, salt, digest };
}

async function derivePasswordDigest(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const copiedSalt = new Uint8Array(salt.byteLength);
  copiedSalt.set(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: copiedSalt, iterations },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function securelyEquals(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function hashCredentialPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derivePasswordDigest(password, salt, PASSWORD_HASH_ITERATIONS);
  return `${PASSWORD_HASH_ALGORITHM}$${PASSWORD_HASH_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(digest)}`;
}

export function createSeededCredentialAuthenticator(
  seeds: readonly CredentialSeed[],
): (username: string, password: string) => Promise<CredentialSession | null> {
  const validSeeds = seeds.filter((seed) =>
    seed.username.trim().length > 0 &&
    AccountIdSchema.safeParse(seed.accountId).success &&
    MemberIdSchema.safeParse(seed.fixedMemberId).success &&
    parsePasswordHash(seed.passwordHash) !== null,
  );

  return async (username, password) => {
    const matchingSeed = validSeeds.find((seed) => seed.username === username);
    const parsedHash = matchingSeed ? parsePasswordHash(matchingSeed.passwordHash) : null;
    if (!matchingSeed || !parsedHash) return null;

    const suppliedDigest = await derivePasswordDigest(password, parsedHash.salt, parsedHash.iterations);
    if (!securelyEquals(suppliedDigest, parsedHash.digest)) return null;

    return {
      kind: "CREDENTIALS",
      accountId: matchingSeed.accountId,
      fixedMemberId: matchingSeed.fixedMemberId,
    };
  };
}
