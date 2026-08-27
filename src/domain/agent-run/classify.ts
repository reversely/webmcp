/** Default classifiers deciding whether a chat message answers a pending question. */

export interface ReplyClassification {
  answers: boolean;
  value?: unknown;
}

export type ReplyClassifier = (text: string, field: string) => ReplyClassification;

/**
 * The reply to `delivery_address` is always the answer: the run asks its address question once,
 * and the next message from any member is stored as the address (what the model reads out of it,
 * or the text verbatim when it reads nothing; see `inferAddress`). The value is the text itself,
 * for the caller to resolve into an address.
 */
export function classifyAddressReply(text: string): ReplyClassification {
  return { answers: true, value: text.trim() };
}

const CLASSIFIERS_BY_FIELD: Record<string, (text: string) => ReplyClassification> = {
  delivery_address: classifyAddressReply
};

/** Routes a reply to the classifier for its field; an unknown field never counts as answered. */
export const classifyReply: ReplyClassifier = (text, field) =>
  CLASSIFIERS_BY_FIELD[field]?.(text) ?? { answers: false };
