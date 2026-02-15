// Offline-aware API wrapper — tries the server first, falls back to IndexedDB cache
// for reads, and queues mutations for later sync when offline.

import * as api from './api';
import type { Group, Member, Expense, Balance, GroupCreatedResponse } from './api';
import {
  cacheGroup, getCachedGroup,
  cacheExpenses, getCachedExpenses,
  cacheBalances, getCachedBalances,
  enqueueMutation,
} from './offlineDb';
import { getStoredGroups } from './storage';

// Re-export all types so components can import from here
export type { Group, Member, Expense, Balance, GroupCreatedResponse };

/** Returns true for expenses created offline that haven't been synced yet */
export function isPending(expense: Expense): boolean {
  return expense.id.startsWith('temp-');
}

function notifyMutationQueued() {
  window.dispatchEvent(new Event('share-cost-mutation-queued'));
}

// ─── Read operations ─────────────────────────────────────────────────────────

export async function getGroup(token: string, groupId?: string): Promise<Group | null> {
  try {
    const group = await api.getGroup(token);
    if (group) await cacheGroup(group);
    return group;
  } catch {
    const gid = groupId || getStoredGroups().find(g => g.token === token)?.id;
    if (gid) return (await getCachedGroup(gid)) ?? null;
    return null;
  }
}

export async function getExpenses(token: string, groupId: string): Promise<Expense[]> {
  try {
    const data = await api.getExpenses(token);
    await cacheExpenses(groupId, data);
    return data;
  } catch {
    return getCachedExpenses(groupId);
  }
}

export async function getBalances(token: string, groupId: string): Promise<Balance[]> {
  try {
    const data = await api.getBalances(token);
    await cacheBalances(groupId, data);
    return data;
  } catch {
    return getCachedBalances(groupId);
  }
}

// ─── Prefetch all groups for offline access ─────────────────────────────────

export async function prefetchAllGroups(): Promise<void> {
  const stored = getStoredGroups();
  await Promise.allSettled(
    stored.map(async (sg) => {
      try {
        const group = await api.getGroup(sg.token);
        if (group) {
          await cacheGroup(group);
          const [expenses, balances] = await Promise.all([
            api.getExpenses(sg.token),
            api.getBalances(sg.token),
          ]);
          await cacheExpenses(group.id, expenses);
          await cacheBalances(group.id, balances);
        }
      } catch {
        // Already cached or truly unreachable — either way, skip
      }
    }),
  );
}

// ─── Group creation (online only) ───────────────────────────────────────────

export async function createGroup(
  name: string,
  memberNames: string[],
  currency?: string,
): Promise<GroupCreatedResponse> {
  // Group creation requires the server (generates token + JWT)
  return api.createGroup(name, memberNames, currency);
}

// ─── Write operations (queue when offline) ───────────────────────────────────

export async function createExpense(
  token: string,
  groupId: string,
  description: string,
  amount: number,
  paidBy: string,
  splitBetween: string[],
  expenseType: string = 'expense',
  transferTo?: string,
  expenseDate?: string,
  currency?: string,
  exchangeRate?: number,
): Promise<Expense> {
  try {
    return await api.createExpense(
      token, description, amount, paidBy, splitBetween,
      expenseType, transferTo, expenseDate, currency, exchangeRate,
    );
  } catch {
    await enqueueMutation(groupId, token, 'createExpense', {
      description, amount, paidBy, splitBetween,
      expenseType, transferTo, expenseDate, currency, exchangeRate,
    });
    const temp: Expense = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      group_id: groupId,
      description,
      amount,
      paid_by: paidBy,
      split_between: splitBetween,
      expense_type: expenseType,
      transfer_to: transferTo || null,
      currency: currency || 'EUR',
      exchange_rate: exchangeRate ?? 1,
      expense_date: expenseDate || new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(),
    };
    const cached = await getCachedExpenses(groupId);
    await cacheExpenses(groupId, [temp, ...cached]);
    notifyMutationQueued();
    return temp;
  }
}

export async function updateExpense(
  token: string,
  groupId: string,
  expenseId: string,
  description: string,
  amount: number,
  paidBy: string,
  splitBetween: string[],
  expenseType: string = 'expense',
  transferTo?: string,
  expenseDate?: string,
  currency?: string,
  exchangeRate?: number,
): Promise<Expense> {
  try {
    return await api.updateExpense(
      token, expenseId, description, amount, paidBy, splitBetween,
      expenseType, transferTo, expenseDate, currency, exchangeRate,
    );
  } catch {
    await enqueueMutation(groupId, token, 'updateExpense', {
      expenseId, description, amount, paidBy, splitBetween,
      expenseType, transferTo, expenseDate, currency, exchangeRate,
    });
    const cached = await getCachedExpenses(groupId);
    const original = cached.find(e => e.id === expenseId);
    const updated: Expense = {
      id: expenseId,
      group_id: groupId,
      description,
      amount,
      paid_by: paidBy,
      split_between: splitBetween,
      expense_type: expenseType,
      transfer_to: transferTo || null,
      currency: currency || 'EUR',
      exchange_rate: exchangeRate ?? 1,
      expense_date: expenseDate || new Date().toISOString().slice(0, 10),
      created_at: original?.created_at || new Date().toISOString(),
    };
    await cacheExpenses(groupId, cached.map(e => e.id === expenseId ? updated : e));
    notifyMutationQueued();
    return updated;
  }
}

export async function deleteExpense(
  token: string,
  groupId: string,
  expenseId: string,
): Promise<void> {
  try {
    await api.deleteExpense(token, expenseId);
  } catch {
    await enqueueMutation(groupId, token, 'deleteExpense', { expenseId });
    const cached = await getCachedExpenses(groupId);
    await cacheExpenses(groupId, cached.filter(e => e.id !== expenseId));
    notifyMutationQueued();
  }
}

export async function addMember(
  token: string,
  groupId: string,
  name: string,
): Promise<Group> {
  try {
    const group = await api.addMember(token, name);
    await cacheGroup(group);
    return group;
  } catch {
    await enqueueMutation(groupId, token, 'addMember', { name });
    const cached = await getCachedGroup(groupId);
    if (cached) {
      const tempMember: Member = {
        id: `temp-${Date.now()}`,
        name,
        paypal_email: null,
        iban: null,
      };
      const updated: Group = { ...cached, members: [...cached.members, tempMember] };
      await cacheGroup(updated);
      notifyMutationQueued();
      return updated;
    }
    throw new Error('Offline and no cached group data');
  }
}

export async function updateMemberPayment(
  token: string,
  groupId: string,
  memberId: string,
  paypalEmail: string | null,
  iban: string | null,
): Promise<Member> {
  try {
    return await api.updateMemberPayment(token, memberId, paypalEmail, iban);
  } catch {
    await enqueueMutation(groupId, token, 'updatePayment', {
      memberId, paypalEmail, iban,
    });
    const cached = await getCachedGroup(groupId);
    if (cached) {
      const updated: Group = {
        ...cached,
        members: cached.members.map(m =>
          m.id === memberId ? { ...m, paypal_email: paypalEmail, iban } : m,
        ),
      };
      await cacheGroup(updated);
    }
    notifyMutationQueued();
    const member = cached?.members.find(m => m.id === memberId);
    return member
      ? { ...member, paypal_email: paypalEmail, iban }
      : { id: memberId, name: '', paypal_email: paypalEmail, iban };
  }
}
