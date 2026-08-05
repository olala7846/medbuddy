import {
  COMPACTION_TRIGGER_UTF16,
  PROTECTED_RECENT_MAX_UTF16,
  RECENT_HARD_CEILING_UTF16,
} from "@medbuddy/contracts";

export type ContinuityPolicy = Readonly<{
  policyVersion: string;
  protectedRecentMaxUtf16: number;
  compactionTriggerUtf16: number;
  recentHardCeilingUtf16: number;
}>;

export const DEFAULT_CONTINUITY_POLICY: ContinuityPolicy = Object.freeze({
  policyVersion: "continuity-v1",
  protectedRecentMaxUtf16: PROTECTED_RECENT_MAX_UTF16,
  compactionTriggerUtf16: COMPACTION_TRIGGER_UTF16,
  recentHardCeilingUtf16: RECENT_HARD_CEILING_UTF16,
});

/** A test-only scale profile. Production composition never selects it implicitly. */
export const VERIFICATION_SMALL_CONTINUITY_POLICY: ContinuityPolicy = Object.freeze({
  policyVersion: "continuity-v1-verification-small",
  protectedRecentMaxUtf16: 600,
  compactionTriggerUtf16: 1_200,
  recentHardCeilingUtf16: 1_800,
});
