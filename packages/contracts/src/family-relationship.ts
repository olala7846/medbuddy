export const ENGLISH_FAMILY_RELATIONSHIP_TERM_PATTERN =
  "mother|mom|mum|father|dad|parent|sister|brother|daughter|son|child|grandmother|grandma|grandfather|grandpa|aunt|uncle|wife|husband|spouse|caregiver";

export const CJK_FAMILY_RELATIONSHIP_TERM_PATTERN =
  "媽媽|母親|爸爸|父親|姊姊|姐姐|妹妹|哥哥|弟弟|女兒|兒子|孩子|祖母|祖父|阿姨|叔叔|妻子|丈夫|配偶|照顧者";

const FAMILY_RELATIONSHIP_TERM = new RegExp(
  `\\b(?:${ENGLISH_FAMILY_RELATIONSHIP_TERM_PATTERN})\\b|(?:${CJK_FAMILY_RELATIONSHIP_TERM_PATTERN})`,
  "iu",
);

/** Shared closed term classifier for material owned by the workspace family map. */
export function containsFamilyRelationshipTerm(value: string): boolean {
  return FAMILY_RELATIONSHIP_TERM.test(value.normalize("NFKC"));
}
