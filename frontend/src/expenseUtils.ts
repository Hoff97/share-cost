import type { Expense } from './api';

// Helper to calculate user's share for a single expense (for totals computation)
export function computeUserShare(expense: Expense, memberId: string): number {
  if (expense.expense_type === 'transfer') {
    if (expense.paid_by === memberId) return -expense.amount * expense.exchange_rate;
    if (expense.transfer_to === memberId) return expense.amount * expense.exchange_rate;
    return 0;
  }
  if (!expense.split_between.includes(memberId)) return 0;
  const splitEntry = expense.splits?.find(s => s.member_id === memberId);
  let share: number;
  if (expense.split_type === 'percentage' && splitEntry?.share != null) {
    share = expense.amount * splitEntry.share / 100;
  } else if (expense.split_type === 'exact' && splitEntry?.share != null) {
    share = splitEntry.share;
  } else if (expense.split_type === 'shares' && splitEntry?.share != null && expense.splits) {
    const totalShares = expense.splits.reduce((s, e) => s + (e.share ?? 0), 0);
    share = totalShares > 0 ? expense.amount * splitEntry.share / totalShares : 0;
  } else {
    share = expense.amount / expense.split_between.length;
  }
  return expense.expense_type === 'income' ? share * expense.exchange_rate : -share * expense.exchange_rate;
}
