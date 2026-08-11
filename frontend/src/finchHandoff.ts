// Handoff with Finch (finances.share-cost.site) - a separate app, same
// registrable domain, no shared auth/DB. Opening this app's popup without
// rel=noopener keeps window.opener alive on this side, which is what makes a
// postMessage handshake possible instead of Finch putting the amount/
// description/a person's name into a URL. Origins are hardcoded, not
// discovered; every inbound message must be validated against both
// event.origin and event.source before being trusted - see App.tsx.

export const FINCH_ORIGIN = "https://finances.share-cost.site";

export type ShareCostEntryType = "expense" | "transfer" | "income";

export interface SplitPrefillMessage {
  source: "finch";
  type: "finch:split-prefill";
  requestId: string;
  entryType: ShareCostEntryType;
  amount: string;
  currency: string;
  description: string;
  date: string;
  counterpartyName: string | null;
  // Money-left-the-account vs money-came-in on Finch's side - amount itself
  // is always unsigned (this app's own form encodes direction via
  // paidBy/transferTo, not sign), but the debt-settlement matcher needs this
  // to tell "I owe them" settlements apart from "they owe me" ones between
  // the same two people for a similar amount.
  isOutgoing: boolean;
}

export interface SplitAddedMessage {
  source: "share-cost";
  type: "share-cost:split-added";
  requestId: string;
  groupName: string;
  expenseId: string;
}

export function isSplitPrefillMessage(data: unknown): data is SplitPrefillMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.source === "finch" && d.type === "finch:split-prefill" && typeof d.requestId === "string";
}

/** No-op if this tab wasn't actually opened by Finch (window.opener unset) -
 * a mismatched targetOrigin also means the browser simply won't deliver it
 * if the opener happens to be some other page. */
export function notifyFinchReady(): void {
  if (!window.opener) return;
  window.opener.postMessage({ source: "share-cost", type: "share-cost:ready" }, FINCH_ORIGIN);
}

export function notifyFinchSplitAdded(message: Omit<SplitAddedMessage, "source" | "type">): void {
  if (!window.opener) return;
  const full: SplitAddedMessage = { source: "share-cost", type: "share-cost:split-added", ...message };
  window.opener.postMessage(full, FINCH_ORIGIN);
}
