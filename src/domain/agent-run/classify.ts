/** Default classifiers deciding whether a chat message answers a pending question. */

export interface ReplyClassification {
  answers: boolean;
  value?: unknown;
}

export type ReplyClassifier = (text: string, field: string) => ReplyClassification;

const ZIP_PATTERN = /\b\d{5}\b/;

/** A reply answers `delivery_address` when it is, or contains, a five-digit ZIP. */
export function classifyAddressReply(text: string): ReplyClassification {
  const match = ZIP_PATTERN.exec(text);
  return match ? { answers: true, value: match[0] } : { answers: false };
}

const CLASSIFIERS_BY_FIELD: Record<string, (text: string) => ReplyClassification> = {
  delivery_address: classifyAddressReply
};

/** Routes a reply to the classifier for its field; an unknown field never counts as answered. */
export const classifyReply: ReplyClassifier = (text, field) =>
  CLASSIFIERS_BY_FIELD[field]?.(text) ?? { answers: false };
