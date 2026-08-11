import type { Member } from './offlineApi';
import type { Settlement } from './settlements';

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function tokenize(name: string): string[] {
  return name.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

// Short tokens ("Al", "Jo") tolerate at most a 1-character slip; longer ones
// ("Mustermann") tolerate 2 - loose enough for a typo, tight enough that
// e.g. "Max" won't accidentally match "Marc".
function tokenDistanceThreshold(tokenLength: number): number {
  return tokenLength <= 4 ? 1 : 2;
}

/** Word-order- and typo-tolerant: "Max Mustermann" matches "Mustermann Max"
 * (reordered) and "Max Mustermann" also loosely matches "Max Mustermann" with
 * a typo. Only every token of the SHORTER name needs a close match among the
 * other's tokens, so a middle name/initial on one side doesn't block a
 * match - e.g. "Max A. Mustermann" still matches "Max Mustermann". */
function tokensLikelyMatch(a: string, b: string): boolean {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  return shorter.every((tok) =>
    longer.some((other) => tok === other || levenshteinDistance(tok, other) <= tokenDistanceThreshold(Math.min(tok.length, other.length))),
  );
}

/** Case-insensitive name match: exact, then same first name, then substring
 * either direction, then a word-order/typo-tolerant fuzzy match - used to
 * find the best-matching member for a free-text name across a whole member
 * list. The first three tiers were promoted out of GroupDetail's own
 * cross-group-transfer flow (behavior unchanged there); the fuzzy tier is
 * new and also backs the Finch-forwarded-transfer detection below. */
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
  const fuzzy = candidates.find((m) => tokensLikelyMatch(m.name, name));
  if (fuzzy) return fuzzy.id;
  return null;
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

/** Purely a confirmation aid, not a decision-maker - by the time this is
 * called, WHO the transfer is with has already been decided by a member
 * name match (see GroupDetail's prefill effect). This just checks whether
 * the amount happens to line up with an outstanding settlement between
 * those two specific people, so the UI can say "matches your settlement"
 * rather than silently prefilling with no explanation. Returns null (no
 * note, not an error) when the transfer doesn't correspond to an existing
 * debt - e.g. it's establishing a brand new one. */
export function findMatchingSettlement(
  settlements: Settlement[],
  memberAId: string,
  memberBId: string,
  amount: number,
): Settlement | null {
  return (
    settlements.find(
      (s) =>
        ((s.from === memberAId && s.to === memberBId) || (s.from === memberBId && s.to === memberAId)) &&
        amountsClose(amount, s.amount),
    ) ?? null
  );
}
