import { z } from "zod";

export const MedicationSourceClaimSchema = z.object({
  text: z.string().trim().min(1),
  sourceOrganization: z.string().trim().min(1),
  sourceUrl: z.url(),
  retrievedAt: z.iso.datetime(),
});

export const MedicationSourceCardSchema = z.object({
  id: z.string().trim().min(1),
  medicationCode: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  identityFields: z.record(z.string(), z.string().trim().min(1)).refine(
    (fields) => Object.keys(fields).length > 0,
    "A source card must identify the medication.",
  ),
  generalConsiderations: z.array(MedicationSourceClaimSchema).min(1),
  limitations: z.array(z.string().trim().min(1)).min(1),
  snapshotVersion: z.string().trim().min(1),
});

export const MedicationQuerySchema = z.object({
  medicationCode: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).optional(),
}).refine(
  (query) => query.medicationCode !== undefined || query.displayName !== undefined,
  "A medication query needs a code or display name.",
);

export type MedicationSourceClaim = z.infer<typeof MedicationSourceClaimSchema>;
export type MedicationSourceCard = z.infer<typeof MedicationSourceCardSchema>;
export type MedicationQuery = z.infer<typeof MedicationQuerySchema>;
