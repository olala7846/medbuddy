import {
  MedicationQuerySchema,
  MedicationSourceCardSchema,
  type MedicationGrounding,
  type MedicationQuery,
  type MedicationSourceCard,
} from "@medbuddy/contracts";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

/**
 * Read-only lookup over source cards committed with the build. It deliberately
 * has no network or persistence dependency.
 */
export class CommittedSourceCardGrounding implements MedicationGrounding {
  readonly #cards: readonly MedicationSourceCard[];

  constructor(cards: readonly MedicationSourceCard[]) {
    this.#cards = cards.map((card) => MedicationSourceCardSchema.parse(card));
  }

  async lookup(query: MedicationQuery): Promise<MedicationSourceCard[]> {
    const parsedQuery = MedicationQuerySchema.parse(query);
    const medicationCode = parsedQuery.medicationCode?.trim().toLocaleUpperCase("en-US");
    const displayName = parsedQuery.displayName && normalize(parsedQuery.displayName);

    return this.#cards
      .filter(
        (card) =>
          (medicationCode === undefined ||
            card.medicationCode.toLocaleUpperCase("en-US") === medicationCode) &&
          (displayName === undefined || normalize(card.displayName) === displayName),
      )
      .map((card) => MedicationSourceCardSchema.parse(card));
  }
}
