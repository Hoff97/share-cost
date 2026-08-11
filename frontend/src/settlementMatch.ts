import type { Member } from './offlineApi';
import type { Settlement } from './settlements';

/** Case-insensitive name match: exact, then same first name, then substring
 * either direction - used to find the best-matching member for a free-text
 * name across a whole member list. Promoted out of GroupDetail's own
 * cross-group-transfer flow (behavior unchanged) so the debt-settlement
 * matcher below can reuse it. */
export function findClosestMember(name: string, members: Member[], excludeId?: string | null): string | null {
  const lower = name.toLowerCase();
  const candidates = excludeId ? members.filter((m) => m.id !== excludeId) : members;
  const exact = candidates.find((m) => m.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const firstName = lower.split(/\s+/)[0];
  const prefix = candidates.find((m) => m.name.toLowerCase().split(/\s+/)[0] === firstName);
  if (prefix) return prefix.id;
  const contains = candidates.find((m) => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
  if (contains) return contains.id;
  return null;
}

/** Same exact -> first-name -> substring cascade as findClosestMember, just
 * for a specific pair rather than picking the best across a list - used to
 * check "is THIS settlement's other party the one Finch told us about",
 * not "which member overall is closest". */
function namesLikelyMatch(a: string, b: string): boolean {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (!la || !lb) return false;
  if (la === lb) return true;
  if (la.split(/\s+/)[0] === lb.split(/\s+/)[0]) return true;
  return la.includes(lb) || lb.includes(la);
}

// Amounts rarely need to match to the cent - a person settling a debt by
// bank transfer often rounds. Exact-to-the-cent always passes; beyond that,
// the wider of a flat and a relative band (whichever tolerates more) is
// used so both a small debt (few cents shouldn't demand 1% precision) and a
// large one (a flat euro is too tight) get a sensible tolerance.
const AMOUNT_TOLERANCE_ABSOLUTE = 1;
const AMOUNT_TOLERANCE_RELATIVE = 0.01;

function amountsClose(a: number, b: number): boolean {
  if (Math.abs(a - b) < 0.005) return true;
  const tolerance = Math.max(AMOUNT_TOLERANCE_ABSOLUTE, Math.abs(b) * AMOUNT_TOLERANCE_RELATIVE);
  return Math.abs(a - b) <= tolerance;
}

export interface SettlementMatch {
  settlement: Settlement;
  /** true when `selectedMemberId` ("me" in this group) is the debtor - a
   * real transfer in that direction should show me as paidBy, them as
   * transferTo; false is the reverse. */
  iOwe: boolean;
}

/** Tries to identify which of the group's outstanding settlements a
 * forwarded Finch transfer corresponds to. Never guesses: returns null
 * unless exactly one settlement survives every filter (involves me, amount
 * close, direction consistent with the transaction's own sign, other
 * party's name plausibly matches what Finch sent) - ambiguity falls back to
 * the existing manual flow rather than silently picking one. */
export function matchSettlement(
  settlements: Settlement[],
  selectedMemberId: string | null,
  counterpartyName: string | null,
  amount: number,
  isOutgoing: boolean,
): SettlementMatch | null {
  if (!selectedMemberId || !counterpartyName?.trim()) return null;

  const candidates = settlements.filter((s) => {
    const involvesMe = s.from === selectedMemberId || s.to === selectedMemberId;
    if (!involvesMe) return false;
    const iOwe = s.from === selectedMemberId;
    // Outgoing money can only be settling a debt I owe; incoming only one
    // owed to me - this alone resolves most ambiguity before names even
    // come into it.
    if (iOwe !== isOutgoing) return false;
    if (!amountsClose(amount, s.amount)) return false;
    const otherName = iOwe ? s.toName : s.fromName;
    return namesLikelyMatch(otherName, counterpartyName);
  });

  if (candidates.length !== 1) return null;
  const settlement = candidates[0];
  return { settlement, iOwe: settlement.from === selectedMemberId };
}
