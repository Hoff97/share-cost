// Handoff with Finch (finances.share-cost.site) - a separate app, same
// registrable domain, no shared auth/DB. Opening this app's popup without
// rel=noopener keeps window.opener alive on this side, which is what makes a
// postMessage handshake possible instead of Finch putting the amount/
// description/a person's name into a URL. Origins are hardcoded, not
// discovered; every inbound message must be validated against both
// event.origin and event.source before being trusted - see App.tsx.

// import.meta.env.DEV lets local dev (`npm run dev` on both apps) talk to
// each other over plain localhost ports without touching the hardcoded
// production origins the deployed apps actually validate against.
export const FINCH_ORIGIN = import.meta.env.DEV ? "http://localhost:5173" : "https://finances.share-cost.site";

export interface SplitPrefillMessage {
  source: "finch";
  type: "finch:split-prefill";
  requestId: string;
  amount: string;
  currency: string;
  description: string;
  date: string;
  counterpartyName: string | null;
  // Money-left-the-account vs money-came-in on Finch's side - amount itself
  // is always unsigned (this app's own form encodes direction via
  // paidBy/transferTo, not sign). Decides Expense vs Income when no group
  // member name-matches counterpartyName, and which side of a Transfer "me"
  // is on when one does - see GroupDetail's prefill effect.
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
