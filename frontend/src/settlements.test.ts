import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateSettlements, type Settlement } from './settlements';
import type { Balance } from './api';

function sortKey(s: Settlement): string {
  return `${s.from}|${s.to}|${s.amount}`;
}

function sorted(settlements: Settlement[]): Settlement[] {
  return [...settlements].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

describe('calculateSettlements', () => {
  it('settles a two-person debt in one transfer', () => {
    const balances: Balance[] = [
      { user_id: 'a', user_name: 'Alice', balance: -30 },
      { user_id: 'b', user_name: 'Bob', balance: 30 },
    ];
    const settlements = calculateSettlements(balances);
    expect(settlements).toEqual([{ from: 'a', fromName: 'Alice', to: 'b', toName: 'Bob', amount: 30 }]);
  });

  it('settles a single-creditor group with one transfer per debtor', () => {
    const balances: Balance[] = [
      { user_id: 'a', user_name: 'Alice', balance: -10 },
      { user_id: 'b', user_name: 'Bob', balance: -20 },
      { user_id: 'c', user_name: 'Carol', balance: 30 },
    ];
    const settlements = calculateSettlements(balances);
    expect(settlements).toHaveLength(2);
    expect(settlements.every((s) => s.to === 'c')).toBe(true);
    expect(settlements.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(30);
  });

  it('returns nothing for an already-settled group', () => {
    const balances: Balance[] = [
      { user_id: 'a', user_name: 'Alice', balance: 0 },
      { user_id: 'b', user_name: 'Bob', balance: 0 },
    ];
    expect(calculateSettlements(balances)).toEqual([]);
  });

  it('returns nothing for an empty group', () => {
    expect(calculateSettlements([])).toEqual([]);
  });

  it('falls back to greedy settling for more than 20 people', () => {
    const balances: Balance[] = [];
    for (let i = 0; i < 24; i++) balances.push({ user_id: `p${i}`, user_name: `P${i}`, balance: -5 });
    balances.push({ user_id: 'creditor', user_name: 'Creditor', balance: 120 });
    const settlements = calculateSettlements(balances);
    expect(settlements).toHaveLength(24);
    expect(settlements.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(120);
  });
});

// Shared with backend/src/settlements.rs's own test suite - both load this
// same file and must agree on every case, proving the Rust port is a
// faithful match rather than just "close enough". Fixtures are chosen small
// enough (2-4 people) that the optimal minimum-transfer solution is
// genuinely unique, so comparing as an order-insensitive set is enough -
// this doesn't depend on both implementations breaking DP ties identically,
// only on picking the same one-and-only-optimal answer.
describe('calculateSettlements matches the shared Rust fixtures', () => {
  const fixturesPath = fileURLToPath(new URL('../../testdata/settlement_fixtures.json', import.meta.url));
  const fixtures: { name: string; balances: Balance[]; expected: { from: string; from_name: string; to: string; to_name: string; amount: number }[] }[] =
    JSON.parse(readFileSync(fixturesPath, 'utf-8'));

  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const actual = sorted(calculateSettlements(fixture.balances));
      const expected = sorted(
        fixture.expected.map((e) => ({ from: e.from, fromName: e.from_name, to: e.to, toName: e.to_name, amount: e.amount })),
      );
      expect(actual).toEqual(expected);
    });
  }
});
