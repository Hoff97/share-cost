import type { Balance } from './api';

export interface Settlement {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

/**
 * Calculate minimum transfers to settle all debts using bitmask DP
 */
export function calculateSettlements(balances: Balance[]): Settlement[] {
  if (balances.length === 0) return [];

  type Person = { id: string; name: string; amount: number };

  // Collect non-zero balances (negative = owes, positive = owed)
  const people: Person[] = [];
  for (const b of balances) {
    if (Math.abs(b.balance) > 0.005) {
      people.push({ id: b.user_id, name: b.user_name, amount: Math.round(b.balance * 100) / 100 });
    }
  }
  if (people.length === 0) return [];

  // Greedy settle within a group of people whose balances sum to ~0
  const greedySettle = (group: Person[]): Settlement[] => {
    const debtors = group.filter(p => p.amount < -0.005).map(p => ({ ...p, amount: Math.abs(p.amount) }));
    const creditors = group.filter(p => p.amount > 0.005).map(p => ({ ...p }));
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);
    const res: Settlement[] = [];
    let di = 0, ci = 0;
    while (di < debtors.length && ci < creditors.length) {
      const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
      if (transfer > 0.005) {
        res.push({
          from: debtors[di].id, fromName: debtors[di].name,
          to: creditors[ci].id, toName: creditors[ci].name,
          amount: Math.round(transfer * 100) / 100,
        });
      }
      debtors[di].amount -= transfer;
      creditors[ci].amount -= transfer;
      if (debtors[di].amount < 0.005) di++;
      if (creditors[ci].amount < 0.005) ci++;
    }
    return res;
  };

  // For small groups, find the partition into zero-sum subsets that maximizes
  // the number of subsets (each subset of size k needs k-1 transfers, so more
  // subsets = fewer total transfers).
  const n = people.length;
  if (n > 20) {
    // Fallback to simple greedy for very large groups
    return greedySettle(people);
  }

  // Precompute subset sums (using integer cents to avoid float issues)
  const cents = people.map(p => Math.round(p.amount * 100));
  const totalSubsets = 1 << n;
  const subsetSum = new Int32Array(totalSubsets);
  for (let mask = 1; mask < totalSubsets; mask++) {
    const lsb = mask & (-mask);
    const bit = Math.log2(lsb);
    subsetSum[mask] = subsetSum[mask ^ lsb] + cents[bit];
  }

  // dp[mask] = max number of independent zero-sum subsets using exactly the people in mask
  // -1 = not achievable
  const dp = new Int16Array(totalSubsets).fill(-1);
  dp[0] = 0;

  // Collect all zero-sum subsets with at least 2 members
  const zeroSubsets: number[] = [];
  for (let mask = 1; mask < totalSubsets; mask++) {
    if (subsetSum[mask] === 0) zeroSubsets.push(mask);
  }

  // DP: iterate over all masks. For each, try removing a zero-sum subset.
  for (let mask = 1; mask < totalSubsets; mask++) {
    // We can always treat the whole mask as one group (0 extra splits)
    // only if mask itself sums to 0
    if (subsetSum[mask] === 0 && dp[mask] < 1) {
      dp[mask] = 1;
    }
    if (dp[mask] < 0) continue;

    // Try adding zero-sum subsets that don't overlap with mask
    for (const zs of zeroSubsets) {
      if ((mask & zs) === 0) {
        const combined = mask | zs;
        if (dp[combined] < dp[mask] + 1) {
          dp[combined] = dp[mask] + 1;
        }
      }
    }
  }

  // Backtrack to find the actual partition
  const fullMask = totalSubsets - 1;
  const groups: Person[][] = [];
  
  // Greedy backtrack: repeatedly find a zero-sum subset to remove
  const backtrack = (mask: number): boolean => {
    if (mask === 0) return true;
    if (dp[mask] < 0) return false;
    // Try removing zero-sum subsets from mask, preferring smaller subsets (more splits)
    for (const zs of zeroSubsets) {
      if ((mask & zs) === zs && dp[mask ^ zs] === dp[mask] - 1) {
        const groupPeople = [];
        for (let i = 0; i < n; i++) {
          if (zs & (1 << i)) groupPeople.push(people[i]);
        }
        groups.push(groupPeople);
        return backtrack(mask ^ zs);
      }
    }
    return false;
  };

  if (dp[fullMask] > 0 && backtrack(fullMask)) {
    // Settle each independent group
    return groups.flatMap(greedySettle);
  }

  // Fallback
  return greedySettle(people);
}
