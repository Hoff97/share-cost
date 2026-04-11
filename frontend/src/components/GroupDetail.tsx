import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import {
  Paper, Title, Text, Button, TextInput, NumberInput, Select, Stack,
  Group as MGroup, SegmentedControl, Checkbox, Badge, Card, Slider,
  Divider, CopyButton, Tooltip, Collapse, Tabs, Anchor, ActionIcon,
  Modal, Switch, CloseButton, Center, useComputedColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { DatePickerInput } from '@mantine/dates';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import 'dayjs/locale/de';
import * as api from '../offlineApi';
import type { Group, Expense, Balance, Permissions, ShareLinkItem } from '../offlineApi';
import { ExpenseCard } from './ExpenseCard';
import { ReceiptScanner } from './ReceiptScanner';
import { computeUserShare } from '../expenseUtils';
import { useSync } from '../sync';
import { getStoredGroup, getStoredGroups, setSelectedMember, updateCachedBalance, updateLastCheckedAt, updateLatestActivity, getStoredPaymentInfo, savePaymentInfo, setShowMyExpensesOnly as setShowMyExpensesOnlyStorage } from '../storage';

interface GroupDetailProps {
  group: Group;
  token: string;
  onGroupUpdated: () => void;
  onGroupDeleted?: () => void;
}

// Today as YYYY-MM-DD
const todayIso = () => new Date().toISOString().slice(0, 10);

// Currency helpers
const CURRENCIES = [
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK',
  'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK',
  'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN',
  'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
];
const currencyData = CURRENCIES.map(c => ({ value: c, label: c }));
const SYM: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
const cs = (c: string) => SYM[c] || c;
const fmtAmt = (n: number, c: string) => {
  const s = SYM[c];
  const abs = Math.abs(n).toFixed(2);
  const sign = n < 0 ? '-' : '';
  return s ? `${sign}${s}${abs}` : `${sign}${abs} ${c}`;
};
const fetchRate = async (from: string, to: string, date: string): Promise<number | null> => {
  if (from === to) return 1;
  try {
    const res = await fetch(`/api/exchange-rate?date=${date}&from=${from}&to=${to}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.rates?.[to] ?? null;
  } catch {
    return null;
  }
};

const snapToMark = (val: number, target: number, max: number) => {
  const threshold = max * 0.02; // snap within 2% of range
  return Math.abs(val - target) < threshold ? target : val;
};

export function GroupDetail({ group, token, onGroupUpdated, onGroupDeleted }: GroupDetailProps) {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme('light');
  const [activeTab, setActiveTab] = useQueryState('tab', parseAsStringLiteral(['expenses', 'balances', 'members'] as const).withDefault('expenses'));

  // Reset tab to expenses when opening a group
  useEffect(() => {
    setActiveTab('expenses');
  }, [group.id]);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | string>('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [splitBetween, setSplitBetween] = useState<string[]>(() => group.members.map(m => m.id));
  const [expenseType, setExpenseType] = useState('expense');
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [expenseDate, setExpenseDate] = useState<string | null>(todayIso());
  const [newMemberName, setNewMemberName] = useState('');
  const [editingPayment, setEditingPayment] = useState<string | null>(null);
  const [editPaypal, setEditPaypal] = useState('');
  const [editIban, setEditIban] = useState('');
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseCurrency, setExpenseCurrency] = useState(group.currency);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [splitType, setSplitType] = useState('equal');
  const [splitShares, setSplitShares] = useState<Record<string, number>>({});
  const [showMyExpensesOnly, setShowMyExpensesOnly] = useState(() => {
    const stored = getStoredGroup(group.id);
    return stored?.showMyExpensesOnly ?? false;
  });
  const [lastCheckedAt] = useState<string | null>(() => {
    const stored = getStoredGroup(group.id);
    return stored?.lastCheckedAt ?? null;
  });
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(() => {
    const stored = getStoredGroup(group.id);
    return stored?.selectedMemberId ?? null;
  });
  // Permissions
  const [permissions, setPermissions] = useState<Permissions>({
    can_delete_group: true,
    can_manage_members: true,
    can_update_payment: true,
    can_add_expenses: true,
    can_edit_expenses: true,
  });
  // Share modal
  const [shareModalOpened, { open: openShareModal, close: closeShareModal }] = useDisclosure(false);
  const [sharePerms, setSharePerms] = useState<Permissions>({
    can_delete_group: false,
    can_manage_members: false,
    can_update_payment: true,
    can_add_expenses: true,
    can_edit_expenses: true,
  });
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);
  const [existingShareLinks, setExistingShareLinks] = useState<ShareLinkItem[]>([]);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [editGroupNameValue, setEditGroupNameValue] = useState('');

  const loadData = useCallback(async () => {
    const [expensesData, balancesData, permsData] = await Promise.all([
      api.getExpenses(token, group.id),
      api.getBalances(token, group.id),
      api.getPermissions(token).catch(() => permissions),
    ]);
    setExpenses(expensesData);
    setBalances(balancesData);
    setPermissions(permsData);

    if (selectedMemberId) {
      const myBalance = balancesData.find(b => b.user_id === selectedMemberId);
      if (myBalance) {
        updateCachedBalance(group.id, myBalance.balance, group.currency);
      }
    }
  }, [token, selectedMemberId, group.id, group.currency]);

  const { syncVersion, initialSyncDone } = useSync();

  useEffect(() => {
    if (!initialSyncDone) return;
    loadData().then(() => {
      updateLastCheckedAt(group.id);
      updateLatestActivity(group.id, group.last_activity_at);
    });
  }, [loadData, group.id, group.last_activity_at, initialSyncDone]);

  // Re-fetch data after sync completes
  useEffect(() => {
    if (syncVersion > 0) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  // Auto-fetch exchange rate for add form
  useEffect(() => {
    if (expenseCurrency === group.currency) { setExchangeRate(1); return; }
    if (!expenseDate) return;
    let cancelled = false;
    fetchRate(expenseCurrency, group.currency, expenseDate).then(rate => {
      if (!cancelled && rate !== null) setExchangeRate(rate);
    });
    return () => { cancelled = true; };
  }, [expenseCurrency, expenseDate, group.currency]);

  // Validation for the add-expense form
  const addAmountNum = typeof amount === 'number' ? amount : parseFloat(amount as string) || 0;
  const isAddFormValid = (() => {
    if (!description.trim() || addAmountNum <= 0 || !paidBy) return false;
    if (expenseType === 'transfer') return !!transferTo;
    if (splitBetween.length === 0) return false;
    if (splitType === 'percentage') {
      const total = splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0);
      return Math.abs(total - 100) < 0.01;
    }
    if (splitType === 'exact') {
      const total = splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0);
      return Math.abs(total - addAmountNum) < 0.01;
    }
    if (splitType === 'shares') {
      return splitBetween.some(id => (splitShares[id] ?? 0) > 0);
    }
    return true;
  })();

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAddFormValid) return;

    await api.createExpense(
      token,
      group.id,
      description,
      typeof amount === 'string' ? parseFloat(amount) : amount,
      paidBy!,
      splitBetween,
      expenseType,
      expenseType === 'transfer' ? (transferTo ?? undefined) : undefined,
      expenseDate || todayIso(),
      expenseCurrency,
      exchangeRate,
      splitType,
      (splitType !== 'equal')
        ? splitBetween.map(id => ({ member_id: id, share: splitShares[id] ?? 0 }))
        : undefined,
    );

    // If receipt items are queued, don't reset — handleReceiptItemSubmitted will pre-fill next item
    if (receiptItems.length === 0 || receiptItemIndex >= receiptItems.length - 1) {
      setDescription('');
      setAmount('');
      setPaidBy(null);
      setSplitBetween(allMemberIds);
      setExpenseType('expense');
      setTransferTo(null);
      setExpenseDate(todayIso());
      setExpenseCurrency(group.currency);
      setExchangeRate(1);
      setSplitType('equal');
      setSplitShares({});
    }
    loadData();
  };

  // Receipt scan: create a single expense from the total
  const handleReceiptSingle = (desc: string, amount: number, date: string | null, currency: string | null) => {
    setDescription(desc);
    setAmount(amount);
    setExpenseType('expense');
    if (date) setExpenseDate(date);
    if (currency) setExpenseCurrency(currency);
    setSplitBetween(allMemberIds);
    setSplitType('equal');
    toggleAddEntry();
  };

  // Receipt scan: queue items for sequential creation
  const handleReceiptItems = (items: Array<{ description: string; amount: number; date: string | null }>, currency: string | null) => {
    if (items.length === 0) return;
    setReceiptItems(items);
    setReceiptItemIndex(0);
    // Pre-fill form with first item
    const first = items[0];
    setDescription(first.description);
    setAmount(first.amount);
    setExpenseType('expense');
    if (first.date) setExpenseDate(first.date);
    if (currency) setExpenseCurrency(currency);
    setSplitBetween(allMemberIds);
    setSplitType('equal');
    toggleAddEntry();
  };

  // When submitting an expense with receipt items queued, advance to the next item
  const handleReceiptItemSubmitted = () => {
    const nextIndex = receiptItemIndex + 1;
    if (nextIndex < receiptItems.length) {
      setReceiptItemIndex(nextIndex);
      const item = receiptItems[nextIndex];
      setDescription(item.description);
      setAmount(item.amount);
      setExpenseType('expense');
      if (item.date) setExpenseDate(item.date);
      setSplitBetween(allMemberIds);
      setSplitType('equal');
    } else {
      // All items processed — clear queue and close
      setReceiptItems([]);
      setReceiptItemIndex(0);
      closeAddEntry();
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;

    await api.addMember(token, group.id, newMemberName.trim());
    setNewMemberName('');
    onGroupUpdated();
  };

  const toggleSplitMember = (memberId: string) => {
    setSplitBetween((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const getMemberName = (memberId: string) => {
    return group.members.find((m) => m.id === memberId)?.name || 'Unknown';
  };

  const getMember = (memberId: string) => {
    return group.members.find((m) => m.id === memberId);
  };

  const handleStartEditPayment = (member: api.Member) => {
    setEditingPayment(member.id);
    setEditPaypal(member.paypal_email || '');
    setEditIban(member.iban || '');
  };

  const handleSavePayment = async (memberId: string) => {
    await api.updateMemberPayment(token, group.id, memberId, editPaypal || null, editIban || null);
    // If editing own payment info, also save to browser for reuse in other groups
    if (memberId === selectedMemberId) {
      savePaymentInfo(editPaypal || null, editIban || null);
    }
    setEditingPayment(null);
    onGroupUpdated();
  };

  const handleOpenShareModal = () => {
    // Reset share link and set defaults capped by own permissions
    setGeneratedShareUrl(null);
    setSharePerms({
      can_delete_group: false,
      can_manage_members: false,
      can_update_payment: permissions.can_update_payment,
      can_add_expenses: permissions.can_add_expenses,
      can_edit_expenses: permissions.can_edit_expenses,
    });
    // Load existing share links
    api.listShareLinks(token).then(setExistingShareLinks).catch(() => {});
    openShareModal();
  };

  const handleGenerateShareLink = async () => {
    try {
      const resp = await api.generateShareLink(token, sharePerms);
      setGeneratedShareUrl(`${window.location.origin}/#join=${resp.code}`);
      // Refresh the list
      api.listShareLinks(token).then(setExistingShareLinks).catch(() => {});
    } catch {
      alert(t('failedShareLink'));
    }
  };

  const handleDeleteShareLink = async (code: string) => {
    try {
      await api.deleteShareLink(token, code);
      setExistingShareLinks(prev => prev.filter(l => l.code !== code));
      // If the deleted link was the currently shown one, clear it
      if (generatedShareUrl?.includes(code)) {
        setGeneratedShareUrl(null);
      }
    } catch {
      alert(t('failedDeleteShareLink'));
    }
  };

  const [deleteGroupModalOpened, { open: openDeleteGroupModal, close: closeDeleteGroupModal }] = useDisclosure(false);
  const [deleteGroupConfirmName, setDeleteGroupConfirmName] = useState('');

  const handleDeleteGroup = async () => {
    try {
      await api.deleteGroup(token);
      closeDeleteGroupModal();
      onGroupDeleted?.();
    } catch {
      alert(t('failedDeleteGroup'));
    }
  };

  const handleSaveGroupName = async () => {
    const trimmed = editGroupNameValue.trim();
    if (!trimmed) return;
    try {
      await api.renameGroup(token, trimmed);
      setEditingGroupName(false);
      onGroupUpdated();
    } catch {
      alert(t('failedRenameGroup'));
    }
  };

  const handleSelectMember = async (memberId: string) => {
    const member = group.members.find(m => m.id === memberId);
    if (member) {
      setSelectedMemberId(memberId);
      setSelectedMember(group.id, memberId, member.name);
      const myBalance = balances.find(b => b.user_id === memberId);
      if (myBalance) {
        updateCachedBalance(group.id, myBalance.balance, group.currency);
      }
      // Auto-apply stored payment info if member has none set
      if (!member.paypal_email && !member.iban) {
        const stored = getStoredPaymentInfo();
        if (stored && (stored.paypal_email || stored.iban)) {
          await api.updateMemberPayment(token, group.id, memberId, stored.paypal_email, stored.iban);
          onGroupUpdated();
        }
      }
    }
  };

  const handleMarkReceived = async (fromId: string, fromName: string, toId: string, toName: string, amount: number) => {
    await api.createExpense(
      token,
      group.id,
      `${t('settlementDesc', { from: fromName, to: toName })}`,
      amount,
      fromId,
      [],
      'transfer',
      toId
    );
    loadData();
  };

  const handleStartEditExpense = (expenseId: string) => {
    setEditingExpenseId(expenseId);
  };

  const handleCancelEditExpense = () => {
    setEditingExpenseId(null);
  };

  const handleSaveExpense = async (expenseId: string, data: {
    description: string;
    amount: number;
    paidBy: string;
    splitBetween: string[];
    expenseType: string;
    transferTo?: string;
    expenseDate: string;
    currency: string;
    exchangeRate: number;
    splitType: string;
    splits?: api.SplitEntry[];
  }) => {
    await api.updateExpense(
      token,
      group.id,
      expenseId,
      data.description,
      data.amount,
      data.paidBy,
      data.splitBetween,
      data.expenseType,
      data.transferTo,
      data.expenseDate,
      data.currency,
      data.exchangeRate,
      data.splitType,
      data.splits,
    );
    setEditingExpenseId(null);
    loadData();
  };

  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null);

  const handleDeleteExpense = async (expenseId: string) => {
    await api.deleteExpense(token, group.id, expenseId);
    setDeleteExpenseId(null);
    loadData();
  };

  const handleConvertExpense = async (expense: Expense) => {
    if (expense.expense_type === 'income') {
      // Income → N transfers: each person in split_between sends their share to paid_by
      const recipients = expense.split_between.filter(id => id !== expense.paid_by);
      const splitCount = expense.split_between.length;
      const shareAmount = Math.round((expense.amount / splitCount) * 100) / 100;
      for (const memberId of recipients) {
        await api.createExpense(
          token, group.id,
          expense.description,
          shareAmount,
          memberId,          // paid_by (the person sending money)
          [],                // splitBetween (not used for transfers)
          'transfer',
          expense.paid_by,   // transfer_to (the income receiver)
          expense.expense_date,
          expense.currency,
          expense.exchange_rate,
        );
      }
    } else if (expense.expense_type === 'transfer') {
      // Transfer → income: create income paid to transfer_to, split between [paid_by]
      await api.createExpense(
        token, group.id,
        expense.description,
        expense.amount,
        expense.transfer_to!,  // the person who was receiving the transfer now receives the income
        [expense.paid_by],     // split between the person who was sending the transfer
        'income',
        undefined,
        expense.expense_date,
        expense.currency,
        expense.exchange_rate,
      );
    }
    await api.deleteExpense(token, group.id, expense.id);
    loadData();
  };

  const myBalance = selectedMemberId
    ? balances.find(b => b.user_id === selectedMemberId)
    : null;

  const memberOptions = group.members.map((m) => ({ value: m.id, label: m.name }));

  const [addEntryOpened, { toggle: toggleAddEntry, close: closeAddEntry }] = useDisclosure(false);
  const [receiptOpened, { toggle: toggleReceipt, close: closeReceipt }] = useDisclosure(false);
  const [receiptItems, setReceiptItems] = useState<Array<{ description: string; amount: number; date: string | null }>>([]);
  const [receiptItemIndex, setReceiptItemIndex] = useState(0);
  const [expandedBalances, setExpandedBalances] = useState<Set<string>>(new Set());
  const [expandedExpenses, setExpandedExpenses] = useState<Set<string>>(new Set());
  const [totalExpanded, setTotalExpanded] = useState(false);

  const toggleExpenseExpanded = (expenseId: string) => {
    setExpandedExpenses(prev => {
      const next = new Set(prev);
      if (next.has(expenseId)) next.delete(expenseId);
      else next.add(expenseId);
      return next;
    });
  };
  const [crossGroupTransfer, setCrossGroupTransfer] = useState<{
    fromId: string; fromName: string; toId: string; toName: string; amount: number;
    targetGroupId: string | null; targetGroupToken: string | null; targetGroupName: string | null;
    targetGroupMembers: api.Member[];
    creditorInTargetId: string | null; myIdInTarget: string | null;
    loading: boolean;
  } | null>(null);

  const allMemberIds = useMemo(() => group.members.map((m) => m.id), [group.members]);

  // When members change (e.g. new member added), include new members in split
  useEffect(() => {
    setSplitBetween(prev => {
      const added = allMemberIds.filter(id => !prev.includes(id));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [allMemberIds]);

  const toggleBalanceExpanded = (userId: string) => {
    setExpandedBalances(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  // Calculate minimum transfers to settle all debts
  interface Settlement {
    from: string;
    fromName: string;
    to: string;
    toName: string;
    amount: number;
  }

  const settlements = useMemo((): Settlement[] => {
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
    // Use bitmask DP over subsets: find all subsets that sum to 0, then find the
    // maximum number of disjoint zero-sum subsets.
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
    let remaining = fullMask;

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
  }, [balances]);

  // Get settlements relevant to a specific member
  const getSettlementsForMember = (userId: string) => {
    const owes: { name: string; id: string; amount: number }[] = [];
    const owedBy: { name: string; id: string; amount: number }[] = [];
    for (const s of settlements) {
      if (s.from === userId) owes.push({ name: s.toName, id: s.to, amount: s.amount });
      if (s.to === userId) owedBy.push({ name: s.fromName, id: s.from, amount: s.amount });
    }
    return { owes, owedBy };
  };

  // Cross-group balance transfer
  const otherGroups = useMemo(() => {
    return getStoredGroups().filter(g => g.id !== group.id);
  }, [group.id]);

  const handleStartCrossGroupTransfer = (fromId: string, fromName: string, toId: string, toName: string, amount: number) => {
    setCrossGroupTransfer({
      fromId, fromName, toId, toName, amount,
      targetGroupId: null, targetGroupToken: null, targetGroupName: null,
      targetGroupMembers: [],
      creditorInTargetId: null, myIdInTarget: null,
      loading: false,
    });
  };

  // Find closest name match from a list of members (case-insensitive substring / prefix)
  const findClosestMember = (name: string, members: api.Member[], excludeId?: string | null): string | null => {
    const lower = name.toLowerCase();
    const candidates = excludeId ? members.filter(m => m.id !== excludeId) : members;
    // Exact match
    const exact = candidates.find(m => m.name.toLowerCase() === lower);
    if (exact) return exact.id;
    // Starts with same prefix (first name match)
    const firstName = lower.split(/\s+/)[0];
    const prefix = candidates.find(m => m.name.toLowerCase().split(/\s+/)[0] === firstName);
    if (prefix) return prefix.id;
    // Contains
    const contains = candidates.find(m => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
    if (contains) return contains.id;
    return null;
  };

  const handleSelectTargetGroup = async (groupId: string) => {
    const targetStored = otherGroups.find(g => g.id === groupId);
    if (!targetStored || !crossGroupTransfer) return;

    // Pre-select based on whether the current user is the debtor or the creditor
    const targetIdentity = targetStored.selectedMemberId || null;
    let preCreditorId: string | null = null;
    let preMyId: string | null = null;
    if (selectedMemberId && targetIdentity) {
      if (selectedMemberId === crossGroupTransfer.fromId) {
        // Current user is the debtor → pre-select them as "you" in the target group
        preMyId = targetIdentity;
      } else if (selectedMemberId === crossGroupTransfer.toId) {
        // Current user is the creditor → pre-select them as the creditor in the target group
        preCreditorId = targetIdentity;
      }
      // Otherwise user is neither party → no pre-selection
    }

    setCrossGroupTransfer(prev => prev ? {
      ...prev, loading: true, targetGroupId: groupId,
      targetGroupName: targetStored.name, targetGroupToken: targetStored.token,
      targetGroupMembers: [], creditorInTargetId: preCreditorId,
      myIdInTarget: preMyId,
    } : null);
    const targetGroup = await api.getGroup(targetStored.token, targetStored.id);
    if (!targetGroup) {
      setCrossGroupTransfer(prev => prev ? { ...prev, loading: false } : null);
      return;
    }

    // Fill remaining empty fields via closest name match
    let finalCreditorId = preCreditorId;
    let finalMyId = preMyId;
    if (!finalCreditorId) {
      finalCreditorId = findClosestMember(crossGroupTransfer.toName, targetGroup.members, finalMyId);
    }
    if (!finalMyId) {
      finalMyId = findClosestMember(crossGroupTransfer.fromName, targetGroup.members, finalCreditorId);
    }

    setCrossGroupTransfer(prev => prev ? {
      ...prev, targetGroupMembers: targetGroup.members, loading: false,
      creditorInTargetId: finalCreditorId, myIdInTarget: finalMyId,
    } : null);
  };

  const handleConfirmCrossGroupTransfer = async () => {
    if (!crossGroupTransfer?.targetGroupToken || !crossGroupTransfer.creditorInTargetId || !crossGroupTransfer.myIdInTarget) return;
    const { fromId, toId, amount, targetGroupToken, targetGroupName, creditorInTargetId, myIdInTarget, targetGroupMembers, targetGroupId } = crossGroupTransfer;
    const myNameInTarget = targetGroupMembers.find(m => m.id === myIdInTarget)?.name || 'Unknown';

    // Settle debt in current group
    await api.createExpense(token, group.id, t('balanceTransferredTo', { group: targetGroupName }), amount, fromId, [], 'transfer', toId);
    // Create corresponding debt in target group
    await api.createExpense(targetGroupToken, targetGroupId || '', t('balanceTransferredFrom', { group: group.name }), amount, creditorInTargetId, [], 'transfer', myIdInTarget);

    // Save identity in target group if not already set
    if (targetGroupId) {
      const targetStored = getStoredGroup(targetGroupId);
      if (!targetStored?.selectedMemberId) {
        setSelectedMember(targetGroupId, myIdInTarget, myNameInTarget);
      }
    }

    setCrossGroupTransfer(null);
    loadData();
  };

  return (
    <Stack gap="lg">
      {/* Header */}
      <MGroup justify="space-between" align="center" wrap="wrap">
        {editingGroupName ? (
          <MGroup gap={4}>
            <TextInput
              value={editGroupNameValue}
              onChange={(e) => setEditGroupNameValue(e.target.value)}
              size="xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveGroupName();
                if (e.key === 'Escape') setEditingGroupName(false);
              }}
              styles={{ input: { fontWeight: 700 } }}
              w={140}
            />
            <ActionIcon size="sm" variant="light" color="blue" onClick={handleSaveGroupName}>
              <Text size="xs">✓</Text>
            </ActionIcon>
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => setEditingGroupName(false)}>
              <Text size="xs">✕</Text>
            </ActionIcon>
          </MGroup>
        ) : (
          <MGroup gap="xs">
            <Title order={2}>{group.name}</Title>
            {permissions.can_delete_group && (
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => { setEditGroupNameValue(group.name); setEditingGroupName(true); }}>
                <Text size="xs">✏️</Text>
              </ActionIcon>
            )}
          </MGroup>
        )}
        <MGroup gap="sm">
          {selectedMemberId ? (
            <MGroup gap="xs">
              <Text size="sm" c="dimmed">{t('youLabel')}:</Text>
              <Select
                size="xs"
                data={memberOptions}
                value={selectedMemberId}
                onChange={(val) => val && handleSelectMember(val)}
                w={130}
              />
              {myBalance && (
                <Badge
                  size="lg"
                  color={myBalance.balance >= 0 ? 'green' : 'red'}
                  variant="filled"
                >
                  {myBalance.balance >= 0 ? '+' : ''}{fmtAmt(myBalance.balance, group.currency)}
                </Badge>
              )}
            </MGroup>
          ) : (
            <Select
              size="sm"
              placeholder={t('whoAreYou')}
              data={memberOptions}
              value={null}
              onChange={(val) => val && handleSelectMember(val)}
              w={160}
            />
          )}
          <Button size="xs" color="green" onClick={handleOpenShareModal}>
            {t('share')}
          </Button>
        </MGroup>
      </MGroup>

      {/* Tabs: Expenses / Balances / Members */}
      <Tabs value={activeTab} onChange={(val) => setActiveTab(val as typeof activeTab)} variant="outline">
        <Tabs.List grow>
          <Tabs.Tab value="expenses">
            {expenses.length > 0 ? t('expensesCount', { count: expenses.length }) : t('expenses')}
          </Tabs.Tab>
          <Tabs.Tab value="balances">
            {t('balances')}
          </Tabs.Tab>
          <Tabs.Tab value="members">
            {t('membersCount', { count: group.members.length })}
          </Tabs.Tab>
        </Tabs.List>

        {/* Expenses Tab */}
        <Tabs.Panel value="expenses" pt="md">
          {/* Add Entry Modal — only shown if user can add expenses */}
          {permissions.can_add_expenses && (
          <>
          <MGroup mb="md">
          <Button style={{ flex: 1 }} onClick={toggleAddEntry}>
            {t('addEntry')}
          </Button>
          <ActionIcon variant="light" size="input-sm" onClick={toggleReceipt} title={t('scanReceipt')}>
            📷
          </ActionIcon>
          </MGroup>
          <ReceiptScanner
            token={token}
            opened={receiptOpened}
            onClose={closeReceipt}
            onCreateSingle={handleReceiptSingle}
            onCreateItems={handleReceiptItems}
          />
          <Modal opened={addEntryOpened} onClose={() => { closeAddEntry(); setReceiptItems([]); setReceiptItemIndex(0); }} title={receiptItems.length > 0 ? `${t('addEntry')} (${receiptItemIndex + 1}/${receiptItems.length})` : t('addEntry')} centered size="md">
              <form onSubmit={(e) => { handleAddExpense(e).then(() => { if (receiptItems.length > 0) { handleReceiptItemSubmitted(); } else { closeAddEntry(); } }); }}>
                <Stack gap="sm">
                  <MGroup gap={4} align="center">
                    <SegmentedControl
                      fullWidth
                      style={{ flex: 1 }}
                      value={expenseType}
                      onChange={(val) => {
                      setExpenseType(val);
                      if (val === 'transfer') {
                        setSplitBetween([]);
                      } else {
                        setTransferTo(null);
                        setSplitBetween(allMemberIds);
                      }
                    }}
                    data={[
                      { label: t('expense'), value: 'expense' },
                      { label: t('transfer'), value: 'transfer' },
                      { label: t('income'), value: 'income' },
                    ]}
                  />
                  <Tooltip label={t('expenseTypeHelp')} multiline w={260} withArrow styles={{ tooltip: { whiteSpace: 'pre-line' } }}>
                    <ActionIcon size="xs" variant="subtle" color="gray" radius="xl">
                      <Text size="xs">?</Text>
                    </ActionIcon>
                  </Tooltip>
                  </MGroup>
                  <TextInput
                    placeholder={t('description')}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <MGroup gap="xs">
                    <NumberInput
                      placeholder={t('amount')}
                      min={0}
                      step={0.01}
                      decimalScale={2}
                      value={amount}
                      onChange={setAmount}
                      leftSection={cs(expenseCurrency)}
                      style={{ flex: 1 }}
                    />
                    <Select
                      data={currencyData}
                      value={expenseCurrency}
                      onChange={(val) => val && setExpenseCurrency(val)}
                      w={90}
                      searchable
                    />
                  </MGroup>
                  {expenseCurrency !== group.currency && (
                    <MGroup gap="xs" align="flex-end">
                      <NumberInput
                        label={t('exchangeRateLabel', { from: expenseCurrency, to: group.currency })}
                        value={exchangeRate}
                        onChange={(val) => setExchangeRate(typeof val === 'string' ? parseFloat(val) || 1 : val)}
                        decimalScale={6}
                        step={0.0001}
                        min={0}
                        size="xs"
                        style={{ flex: 1 }}
                      />
                      {typeof amount === 'number' && amount > 0 && (
                        <Text size="xs" c="dimmed" pb={2}>
                          ≈ {fmtAmt(amount * exchangeRate, group.currency)}
                        </Text>
                      )}
                    </MGroup>
                  )}
                  <Select
                    placeholder={expenseType === 'transfer' ? t('fromWho') : expenseType === 'income' ? t('receivedBy') : t('whoPaid')}
                    data={memberOptions}
                    value={paidBy}
                    onChange={setPaidBy}
                    clearable
                  />
                  {expenseType === 'transfer' ? (
                    <Select
                      placeholder={t('toWho')}
                      data={memberOptions.filter(m => m.value !== paidBy)}
                      value={transferTo}
                      onChange={setTransferTo}
                      clearable
                    />
                  ) : (
                    <div>
                      <Text size="sm" fw={500} mb={4}>{t('splitBetween')}</Text>
                      <Stack gap={4}>
                        <Checkbox
                          label={t('everyone')}
                          fw={600}
                          checked={splitBetween.length === group.members.length}
                          indeterminate={splitBetween.length > 0 && splitBetween.length < group.members.length}
                          onChange={() =>
                            setSplitBetween(splitBetween.length === group.members.length ? [] : allMemberIds)
                          }
                        />
                        {group.members.map((member) => (
                          <Checkbox
                            key={member.id}
                            label={member.name}
                            checked={splitBetween.includes(member.id)}
                            onChange={() => toggleSplitMember(member.id)}
                            ml="md"
                          />
                        ))}
                      </Stack>
                      {splitBetween.length > 0 && (
                        <>
                          <MGroup gap={4} align="center">
                            <Text size="sm" fw={500}>{t('splitMethod')}</Text>
                            <Tooltip label={t('splitMethodHelp')} multiline w={260} withArrow styles={{ tooltip: { whiteSpace: 'pre-line' } }}>
                              <ActionIcon size="xs" variant="subtle" color="gray" radius="xl">
                                <Text size="xs">?</Text>
                              </ActionIcon>
                            </Tooltip>
                          </MGroup>
                          <SegmentedControl
                            fullWidth
                            size="xs"
                            value={splitType}
                            onChange={(val) => {
                              const prev = splitType;
                              setSplitType(val);
                              if (val !== 'equal' && splitBetween.length > 0) {
                                const n = splitBetween.length;
                                const totalAmt = typeof amount === 'number' ? amount : parseFloat(amount as string) || 0;
                                if (val === 'shares') {
                                  // Always prefill with default 10 shares each
                                  setSplitShares(Object.fromEntries(splitBetween.map(id => [id, 10])));
                                } else {
                                  const hasValues = prev !== 'equal' && prev !== 'shares' && Object.keys(splitShares).length > 0;
                                  if (hasValues && totalAmt > 0) {
                                    // Convert existing values between percentage <-> exact
                                    if (prev === 'percentage' && val === 'exact') {
                                      setSplitShares(Object.fromEntries(splitBetween.map(id => [id, Math.round((splitShares[id] ?? 0) / 100 * totalAmt * 100) / 100])));
                                    } else if (prev === 'exact' && val === 'percentage') {
                                      setSplitShares(Object.fromEntries(splitBetween.map(id => [id, Math.round((splitShares[id] ?? 0) / totalAmt * 10000) / 100])));
                                    }
                                  } else {
                                    // First time switching from equal/shares — prefill with equal split
                                    const equalShare = val === 'percentage'
                                      ? Math.round(10000 / n) / 100
                                      : Math.round(totalAmt / n * 100) / 100;
                                    setSplitShares(Object.fromEntries(splitBetween.map(id => [id, equalShare])));
                                  }
                                }
                              }
                            }}
                            data={[
                              { label: t('equal'), value: 'equal' },
                              { label: t('percentage'), value: 'percentage' },
                              { label: t('exact'), value: 'exact' },
                              { label: t('shares'), value: 'shares' },
                            ]}
                          />
                          {splitType !== 'equal' && (
                            <Stack gap={4} mt="xs">
                              {splitBetween.map(id => {
                                const totalSharesVal = splitType === 'shares' ? splitBetween.reduce((s, mid) => s + (splitShares[mid] ?? 0), 0) : 0;
                                const totalAmt = typeof amount === 'number' ? amount : parseFloat(amount as string) || 0;
                                const equivAmt = totalSharesVal > 0 ? totalAmt * (splitShares[id] ?? 0) / totalSharesVal : 0;
                                return (
                                <Stack key={id} gap={2}>
                                  <MGroup gap="xs" align="center">
                                    <Text size="sm" style={{ flex: 1 }}>{getMemberName(id)}</Text>
                                    {splitType === 'shares' && (
                                      <ActionIcon size="xs" variant="light" onClick={() => setSplitShares(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) - 1) }))}>
                                        <Text size="xs" fw={700}>−</Text>
                                      </ActionIcon>
                                    )}
                                    <NumberInput
                                      size="xs"
                                      w={splitType === 'shares' ? 60 : 100}
                                      min={0}
                                      step={splitType === 'shares' ? 1 : splitType === 'percentage' ? 1 : 0.01}
                                      decimalScale={splitType === 'shares' ? 0 : 2}
                                      value={splitShares[id] ?? ''}
                                      onChange={(val) => setSplitShares(prev => ({ ...prev, [id]: typeof val === 'string' ? parseFloat(val) || 0 : val }))}
                                      rightSection={splitType === 'percentage' ? <Text size="xs">%</Text> : splitType === 'shares' ? <Text size="xs">×</Text> : <Text size="xs">{cs(expenseCurrency)}</Text>}
                                    />
                                    {splitType === 'shares' && (
                                      <ActionIcon size="xs" variant="light" onClick={() => setSplitShares(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))}>
                                        <Text size="xs" fw={700}>+</Text>
                                      </ActionIcon>
                                    )}
                                    {splitType === 'shares' && (
                                      <Text size="xs" c="dimmed" w={70} ta="right">{fmtAmt(equivAmt, expenseCurrency)}</Text>
                                    )}
                                  </MGroup>
                                  {splitType === 'percentage' && (() => {
                                    const target = Math.max(0, Math.min(100, 100 - splitBetween.filter(o => o !== id).reduce((s, o) => s + (splitShares[o] ?? 0), 0)));
                                    return <Slider
                                      size="sm"
                                      min={0}
                                      max={100}
                                      step={0.5}
                                      value={splitShares[id] ?? 0}
                                      onChange={(val) => setSplitShares(prev => ({ ...prev, [id]: snapToMark(val, target, 100) }))}
                                      label={(v) => `${v}%`}
                                      marks={[{ value: target, label: `${target.toFixed(1)}%` }]}
                                    />;
                                  })()}
                                  {splitType === 'exact' && (() => {
                                    const totalAmt = typeof amount === 'number' ? amount : parseFloat(amount as string) || 0;
                                    const target = Math.max(0, Math.min(totalAmt, totalAmt - splitBetween.filter(o => o !== id).reduce((s, o) => s + (splitShares[o] ?? 0), 0)));
                                    return <Slider
                                      size="sm"
                                      min={0}
                                      max={totalAmt || 100}
                                      step={0.01}
                                      value={splitShares[id] ?? 0}
                                      onChange={(val) => setSplitShares(prev => ({ ...prev, [id]: Math.round(snapToMark(val, target, totalAmt || 100) * 100) / 100 }))}
                                      label={(v) => `${v.toFixed(2)}`}
                                      marks={[{ value: target, label: target.toFixed(2) }]}
                                    />;
                                  })()}
                                </Stack>
                              );
                              })}
                              {splitType === 'shares' ? (
                                <Text size="xs" mt="md" c="dimmed">
                                  {t('totalShares')}: {splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0)}
                                </Text>
                              ) : (
                                <Text size="xs" mt="md" c={
                                  splitType === 'percentage'
                                    ? Math.abs(splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0) - 100) < 0.01 ? 'green' : 'red'
                                    : Math.abs(splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0) - (typeof amount === 'number' ? amount : parseFloat(amount as string) || 0)) < 0.01 ? 'green' : 'red'
                                }>
                                  Total: {splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0).toFixed(2)}
                                  {splitType === 'percentage' ? '% / 100%' : ` / ${typeof amount === 'number' ? amount.toFixed(2) : parseFloat(amount as string)?.toFixed(2) || '0.00'} ${cs(expenseCurrency)}`}
                                </Text>
                              )}
                            </Stack>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <DatePickerInput
                    label={t('date')}
                    placeholder={t('pickDate')}
                    value={expenseDate}
                    onChange={setExpenseDate}
                    locale="de"
                    valueFormat="DD.MM.YYYY"
                    clearable
                    maxDate={new Date()}
                  />
                  <Button type="submit" fullWidth disabled={!isAddFormValid}>
                    {expenseType === 'transfer' ? t('addTransfer') : expenseType === 'income' ? t('addIncome') : t('addExpense')}
                  </Button>
                  {receiptItems.length > 0 && (
                    <Button fullWidth variant="subtle" color="gray" onClick={() => {
                      handleReceiptItemSubmitted();
                    }}>
                      {t('receiptSkipItem')}
                    </Button>
                  )}
                </Stack>
              </form>
          </Modal>
          </>
          )}

          {selectedMemberId && (
            <MGroup gap="xs" mb="xs">
              <Checkbox
                label={t('showMyExpensesOnly')}
                checked={showMyExpensesOnly}
                onChange={(e) => {
                  setShowMyExpensesOnly(e.currentTarget.checked);
                  setShowMyExpensesOnlyStorage(group.id, e.currentTarget.checked);
                }}
                size="sm"
              />
            </MGroup>
          )}

          <Stack gap="xs">
            {expenses.length === 0 ? (
              <Text c="dimmed" ta="center" py="lg">{t('noExpenses')}</Text>
            ) : (
              (() => {
                const filtered = showMyExpensesOnly && selectedMemberId
                  ? expenses.filter(exp =>
                      exp.paid_by === selectedMemberId ||
                      exp.transfer_to === selectedMemberId ||
                      exp.split_between.includes(selectedMemberId)
                    )
                  : expenses;

                // Compute totals
                const totalAll = expenses.reduce((sum, exp) => {
                  const amt = exp.amount * exp.exchange_rate;
                  if (exp.expense_type === 'transfer') return sum;
                  return exp.expense_type === 'income' ? sum - amt : sum + amt;
                }, 0);

                const totalUser = selectedMemberId
                  ? expenses.reduce((sum, exp) => {
                      if (exp.expense_type === 'transfer') return sum;
                      return sum + computeUserShare(exp, selectedMemberId);
                    }, 0)
                  : null;

                return (
                  <>
                    {filtered.length === 0 ? (
                      <Text c="dimmed" ta="center" py="lg">{t('noMatchingExpenses')}</Text>
                    ) : (
                      filtered.map((expense) => (
                        <ExpenseCard
                          key={expense.id}
                          expense={expense}
                          groupCurrency={group.currency}
                          members={group.members}
                          selectedMemberId={selectedMemberId}
                          canEdit={permissions.can_edit_expenses}
                          isEditing={editingExpenseId === expense.id}
                          isExpanded={expandedExpenses.has(expense.id)}
                          isNew={!!lastCheckedAt && expense.created_at > lastCheckedAt}
                          onStartEdit={() => handleStartEditExpense(expense.id)}
                          onCancelEdit={handleCancelEditExpense}
                          onSaveEdit={(data) => handleSaveExpense(expense.id, data)}
                          onDelete={() => setDeleteExpenseId(expense.id)}
                          onConvert={() => handleConvertExpense(expense)}
                          onToggleExpand={() => toggleExpenseExpanded(expense.id)}
                        />
                      ))
                    )}
                    <Paper p="sm" radius="md" bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))" mt="xs" style={{ cursor: 'pointer' }} onClick={() => setTotalExpanded(v => !v)}>
                      <MGroup justify="space-between">
                        <MGroup gap="xs">
                          <Text size="sm" c="dimmed" style={{ transition: 'transform 200ms', transform: totalExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</Text>
                          <Text size="sm" fw={600}>{t('totalExpenses')}</Text>
                        </MGroup>
                        <Text size="sm" fw={700} c="blue">{fmtAmt(totalAll, group.currency)}</Text>
                      </MGroup>
                      {totalUser != null && (
                        <MGroup justify="space-between" mt={4}>
                          <Text size="sm" fw={600} pl={20}>{t('yourTotal')}</Text>
                          <Text size="sm" fw={700} c={totalUser >= 0 ? 'teal' : 'red'}>{fmtAmt(totalUser, group.currency)}</Text>
                        </MGroup>
                      )}
                      <Collapse in={totalExpanded}>
                        <Divider my="xs" />
                        <MGroup justify="space-between" mb={4}>
                          <Text size="xs" fw={600} c="dimmed" style={{ flex: 1 }}></Text>
                          <Text size="xs" fw={600} c="dimmed" w={80} ta="right">{t('expenseShare')}</Text>
                          <Text size="xs" fw={600} c="dimmed" w={80} ta="right">{t('totalPaid')}</Text>
                        </MGroup>
                        {group.members.map(m => {
                          const memberTotal = expenses.reduce((sum, exp) => {
                            if (exp.expense_type === 'transfer') return sum;
                            return sum + computeUserShare(exp, m.id);
                          }, 0);
                          const paid = expenses.reduce((sum, exp) => {
                            const amt = exp.amount * exp.exchange_rate;
                            if (exp.expense_type === 'transfer') {
                              if (exp.paid_by === m.id) return sum + amt;
                              if (exp.transfer_to === m.id) return sum - amt;
                              return sum;
                            }
                            if (exp.paid_by !== m.id) return sum;
                            return exp.expense_type === 'income' ? sum - amt : sum + amt;
                          }, 0);
                          return (
                            <MGroup key={m.id} justify="space-between" mt={2}>
                              <Text size="xs" c="dimmed" style={{ flex: 1 }}>{m.name}</Text>
                              <Text size="xs" fw={600} c={memberTotal >= 0 ? 'teal' : 'red'} w={80} ta="right">{fmtAmt(memberTotal, group.currency)}</Text>
                              <Text size="xs" fw={600} w={80} ta="right">{fmtAmt(paid, group.currency)}</Text>
                            </MGroup>
                          );
                        })}
                      </Collapse>
                    </Paper>
                  </>
                );
              })()
            )}
          </Stack>
        </Tabs.Panel>

        {/* Balances Tab */}
        <Tabs.Panel value="balances" pt="md">
          <Stack gap="xs">
            {settlements.length > 0 && (
              <Paper p="sm" radius="md" bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))" mb="xs">
                <Text size="sm" c="dimmed" ta="center">
                  {t('transfersNeeded', { count: settlements.length })}
                </Text>
              </Paper>
            )}
            {balances.map((balance) => {
              const isExpanded = expandedBalances.has(balance.user_id);
              const { owes, owedBy } = getSettlementsForMember(balance.user_id);
              const hasSettlements = owes.length > 0 || owedBy.length > 0;

              return (
                <Card
                  key={balance.user_id}
                  padding="sm"
                  radius="md"
                  withBorder
                  style={{
                    cursor: hasSettlements ? 'pointer' : undefined,
                    ...(balance.user_id === selectedMemberId ? {
                      borderColor: 'var(--mantine-color-blue-6)',
                      borderWidth: 2,
                      background: 'light-dark(var(--mantine-color-blue-0), var(--mantine-color-blue-9))',
                    } : {}),
                  }}
                  onClick={() => hasSettlements && toggleBalanceExpanded(balance.user_id)}
                >
                  <MGroup justify="space-between">
                    <MGroup gap="xs">
                      {hasSettlements && (
                        <Text size="sm" c="dimmed" style={{ transition: 'transform 200ms', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                          ▾
                        </Text>
                      )}
                      <Text fw={600}>
                        {balance.user_name}
                        {balance.user_id === selectedMemberId && (
                          <Text component="span" c="light-dark(var(--mantine-color-blue-7), var(--mantine-color-blue-3))" fw={500}> {t('youLabel')}</Text>
                        )}
                      </Text>
                    </MGroup>
                    <Text fw={700} size="lg" c={balance.balance >= 0 ? 'green' : 'red'}>
                      {balance.balance >= 0 ? '+' : ''}{fmtAmt(balance.balance, group.currency)}
                    </Text>
                  </MGroup>
                  <Collapse in={isExpanded}>
                    <Divider my="xs" />
                    <Stack gap={4}>
                      {owes.map((o, i) => {
                        const recipient = getMember(o.id);
                        return (
                          <div key={`owe-${i}`}>
                            <MGroup gap="xs">
                              <Text size="sm" c="red">→ {t('pay')}</Text>
                              <Text size="sm" fw={500}>{o.name}</Text>
                              <Text size="sm" fw={600} c="red">{fmtAmt(o.amount, group.currency)}</Text>
                            </MGroup>
                            {recipient?.paypal_email && (
                              <MGroup gap="xs" ml="md" mt={2}>
                                <Badge size="xs" color="indigo" variant="filled">PayPal</Badge>
                                <Anchor
                                  size="xs"
                                  fw={600}
                                  style={{ color: 'var(--mantine-color-indigo-4)' }}
                                  href={`https://paypal.me/${recipient.paypal_email}/${o.amount.toFixed(2).replace('.', ',')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {t('payViaPaypal')}
                                </Anchor>
                              </MGroup>
                            )}
                            {recipient?.iban && (
                              <MGroup gap="xs" ml="md" mt={2}>
                                <Badge size="xs" color="gray" variant="light">IBAN</Badge>
                                <Text size="xs" ff="monospace">{recipient.iban}</Text>
                                <CopyButton value={recipient.iban}>
                                  {({ copied, copy }) => (
                                    <Tooltip label={copied ? t('copied') : t('copyIBAN')}>
                                      <Button size="compact-xs" variant="subtle" onClick={(e) => { e.stopPropagation(); copy(); }}>
                                        {copied ? '✓' : '📋'}
                                      </Button>
                                    </Tooltip>
                                  )}
                                </CopyButton>
                              </MGroup>
                            )}
                            {otherGroups.length > 0 && (
                              crossGroupTransfer?.fromId === balance.user_id && crossGroupTransfer?.toId === o.id ? (
                                <Paper p="xs" ml="md" mt={4} withBorder radius="sm" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                  <Stack gap="xs">
                                    <Select
                                      size="xs"
                                      placeholder={t('selectGroup')}
                                      data={otherGroups.map(g => ({ value: g.id, label: g.name }))}
                                      value={crossGroupTransfer.targetGroupId}
                                      onChange={(val) => val && handleSelectTargetGroup(val)}
                                    />
                                    {crossGroupTransfer.loading && <Text size="xs" c="dimmed">{t('loadingMembers')}</Text>}
                                    {crossGroupTransfer.targetGroupMembers.length > 0 && (
                                      <>
                                        <Select
                                          size="xs"
                                          label={t('whoIsMemberInGroup', { name: o.name, group: crossGroupTransfer.targetGroupName })}
                                          placeholder={t('selectMember')}
                                          data={crossGroupTransfer.targetGroupMembers.map(m => ({ value: m.id, label: m.name }))}
                                          value={crossGroupTransfer.creditorInTargetId}
                                          onChange={(val) => setCrossGroupTransfer(prev => prev ? { ...prev, creditorInTargetId: val } : null)}
                                        />
                                        <Select
                                          size="xs"
                                          label={t('whoIsMemberInGroup', { name: balance.user_name, group: crossGroupTransfer.targetGroupName })}
                                          placeholder={t('selectMember')}
                                          data={crossGroupTransfer.targetGroupMembers.filter(m => m.id !== crossGroupTransfer.creditorInTargetId).map(m => ({ value: m.id, label: m.name }))}
                                          value={crossGroupTransfer.myIdInTarget}
                                          onChange={(val) => setCrossGroupTransfer(prev => prev ? { ...prev, myIdInTarget: val } : null)}
                                        />
                                        <MGroup gap="xs">
                                          <Button
                                            size="compact-xs"
                                            color="violet"
                                            disabled={!crossGroupTransfer.creditorInTargetId || !crossGroupTransfer.myIdInTarget}
                                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleConfirmCrossGroupTransfer(); }}
                                          >
                                            {t('transferAmount', { amount: fmtAmt(o.amount, group.currency) })}
                                          </Button>
                                          <Button
                                            size="compact-xs"
                                            variant="subtle"
                                            color="gray"
                                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setCrossGroupTransfer(null); }}
                                          >
                                            {t('cancel')}
                                          </Button>
                                        </MGroup>
                                      </>
                                    )}
                                  </Stack>
                                </Paper>
                              ) : (
                                <MGroup gap="xs" ml="md" mt={2}>
                                  <Badge size="xs" color="violet" variant="light">Group</Badge>
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="violet"
                                    onClick={(e: React.MouseEvent) => {
                                      e.stopPropagation();
                                      handleStartCrossGroupTransfer(balance.user_id, balance.user_name, o.id, o.name, o.amount);
                                    }}
                                  >
                                    {t('transferToOtherGroup')}
                                  </Button>
                                </MGroup>
                              )
                            )}
                          </div>
                        );
                      })}
                      {owedBy.map((o, i) => (
                        <MGroup key={`owed-${i}`} gap="xs" justify="space-between">
                          <MGroup gap="xs">
                            <Text size="sm" c="green">← {t('receiveFrom')}</Text>
                            <Text size="sm" fw={500}>{o.name}</Text>
                            <Text size="sm" fw={600} c="green">{fmtAmt(o.amount, group.currency)}</Text>
                          </MGroup>
                          <Tooltip label={t('recordPayment', { from: o.name, to: balance.user_name })}>
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="green"
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleMarkReceived(o.id, o.name, balance.user_id, balance.user_name, o.amount); }}
                            >
                              {t('received')}
                            </Button>
                          </Tooltip>
                        </MGroup>
                      ))}
                      {!hasSettlements && (
                        <Text size="sm" c="dimmed">{t('allSettled')}</Text>
                      )}
                    </Stack>
                  </Collapse>
                </Card>
              );
            })}
          </Stack>
        </Tabs.Panel>

        {/* Members Tab */}
        <Tabs.Panel value="members" pt="md">
          <Stack gap="xs">
            {group.members.map((member) => (
              <Card
                key={member.id}
                padding="sm"
                radius="md"
                withBorder
                style={member.id === selectedMemberId ? {
                  borderColor: 'var(--mantine-color-blue-6)',
                  borderWidth: 2,
                  background: 'light-dark(var(--mantine-color-blue-0), var(--mantine-color-blue-9))',
                } : undefined}
              >
                <MGroup justify="space-between" align="center">
                  <Text fw={600}>
                    {member.name}
                    {member.id === selectedMemberId && (
                      <Text component="span" c="light-dark(var(--mantine-color-blue-7), var(--mantine-color-blue-3))" fw={500}> {t('youLabel')}</Text>
                    )}
                  </Text>
                  <MGroup gap="xs">
                    {member.paypal_email && <Badge size="xs" color="indigo" variant="light">PayPal</Badge>}
                    {member.iban && <Badge size="xs" color="gray" variant="light">IBAN</Badge>}
                    {editingPayment !== member.id && permissions.can_update_payment && (
                      <Button size="compact-xs" variant="subtle" onClick={() => handleStartEditPayment(member)}>
                        ✏️
                      </Button>
                    )}
                  </MGroup>
                </MGroup>
                {editingPayment === member.id && (
                  <>
                    <Divider my="xs" />
                    <Stack gap="xs">
                      <TextInput
                        size="xs"
                        placeholder={t('paypalPlaceholder')}
                        leftSection={<Text size="xs">💳</Text>}
                        value={editPaypal}
                        onChange={(e) => setEditPaypal(e.target.value)}
                      />
                      <TextInput
                        size="xs"
                        placeholder={t('ibanPlaceholder')}
                        leftSection={<Text size="xs">🏦</Text>}
                        value={editIban}
                        onChange={(e) => setEditIban(e.target.value)}
                      />
                      <MGroup gap="xs">
                        <Button size="compact-xs" onClick={() => handleSavePayment(member.id)}>{t('save')}</Button>
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setEditingPayment(null)}>{t('cancel')}</Button>
                      </MGroup>
                    </Stack>
                  </>
                )}
                {editingPayment !== member.id && (member.paypal_email || member.iban) && (
                  <>
                    <Divider my="xs" />
                    <Stack gap={2}>
                      {member.paypal_email && (
                        <Text size="xs" c="dimmed">PayPal: <Anchor style={{ color: 'var(--mantine-color-indigo-4)' }} href={`https://paypal.me/${member.paypal_email}`} target="_blank" rel="noopener noreferrer">{member.paypal_email}</Anchor></Text>
                      )}
                      {member.iban && (
                        <MGroup gap="xs">
                          <Text size="xs" c="dimmed">IBAN: {member.iban}</Text>
                          <CopyButton value={member.iban}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? t('copied') : t('copyIBAN')}>
                                <Button size="compact-xs" variant="subtle" onClick={copy}>
                                  {copied ? '✓' : '📋'}
                                </Button>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </MGroup>
                      )}
                    </Stack>
                  </>
                )}
              </Card>
            ))}
          </Stack>
          {permissions.can_manage_members && (
            <>
              <Divider my="sm" />
              <form onSubmit={handleAddMember}>
                <MGroup gap="xs">
                  <TextInput
                    placeholder={t('addNewMember')}
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Button type="submit" variant="light">{t('add')}</Button>
                </MGroup>
              </form>
            </>
          )}
          {permissions.can_delete_group && (
            <>
              <Divider my="md" />
              <Button color="red" variant="light" fullWidth onClick={() => { setDeleteGroupConfirmName(''); openDeleteGroupModal(); }}>
                {t('deleteGroup')}
              </Button>
            </>
          )}
        </Tabs.Panel>
      </Tabs>

      {/* Share Link Modal */}
      <Modal opened={shareModalOpened} onClose={closeShareModal} title={t('shareThisGroup')} centered size="md">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {t('sharePermissionsDesc')}
          </Text>
          <Stack gap="xs">
            <Switch
              label={t('permDeleteGroup')}
              checked={sharePerms.can_delete_group}
              onChange={(e) => { const v = e.currentTarget.checked; setSharePerms(p => ({ ...p, can_delete_group: v })); }}
              disabled={!permissions.can_delete_group}
            />
            <Switch
              label={t('permManageMembers')}
              checked={sharePerms.can_manage_members}
              onChange={(e) => { const v = e.currentTarget.checked; setSharePerms(p => ({ ...p, can_manage_members: v })); }}
              disabled={!permissions.can_manage_members}
            />
            <Switch
              label={t('permUpdatePayment')}
              checked={sharePerms.can_update_payment}
              onChange={(e) => { const v = e.currentTarget.checked; setSharePerms(p => ({ ...p, can_update_payment: v })); }}
              disabled={!permissions.can_update_payment}
            />
            <Switch
              label={t('permAddExpenses')}
              checked={sharePerms.can_add_expenses}
              onChange={(e) => { const v = e.currentTarget.checked; setSharePerms(p => ({ ...p, can_add_expenses: v })); }}
              disabled={!permissions.can_add_expenses}
            />
            <Switch
              label={t('permEditExpenses')}
              checked={sharePerms.can_edit_expenses}
              onChange={(e) => { const v = e.currentTarget.checked; setSharePerms(p => ({ ...p, can_edit_expenses: v })); }}
              disabled={!permissions.can_edit_expenses}
            />
          </Stack>
          {!generatedShareUrl ? (
            <Button onClick={handleGenerateShareLink} fullWidth>
              {t('generateShareLink')}
            </Button>
          ) : (
            <Stack gap="xs">
              <Center>
                <Paper p="xs" radius="lg" withBorder shadow="sm" style={{ display: 'inline-block' }}>
                  <QRCodeSVG value={generatedShareUrl} size={180} bgColor="transparent" fgColor={colorScheme === 'dark' ? '#c1c2c5' : '#000000'} />
                </Paper>
              </Center>
              <TextInput
                value={generatedShareUrl}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <CopyButton value={generatedShareUrl}>
                {({ copied, copy }) => (
                  <Button color={copied ? 'teal' : 'blue'} onClick={copy} fullWidth>
                    {copied ? `✓ ${t('copied')}` : t('copyLink')}
                  </Button>
                )}
              </CopyButton>
            </Stack>
          )}

          {existingShareLinks.length > 0 && (
            <>
              <Divider label={t('existingShareLinks')} labelPosition="center" />
              <Stack gap="xs">
                {existingShareLinks.map(link => {
                  const permLabels: string[] = [];
                  if (link.can_add_expenses) permLabels.push(t('permBadgeAdd'));
                  if (link.can_edit_expenses) permLabels.push(t('permBadgeEdit'));
                  if (link.can_update_payment) permLabels.push(t('permBadgePayment'));
                  if (link.can_manage_members) permLabels.push(t('permBadgeMembers'));
                  if (link.can_delete_group) permLabels.push(t('permBadgeDelete'));
                  const url = `${window.location.origin}/#join=${link.code}`;
                  const isOldLink = link.code.length < 20;
                  return (
                    <Paper key={link.code} p="xs" withBorder radius="sm">
                      <MGroup justify="space-between" wrap="nowrap" gap="xs">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <MGroup gap={4} wrap="nowrap">
                            <Text size="xs" truncate="end" ff="monospace">{link.code}</Text>
                            {isOldLink && (
                              <Tooltip label={t('oldShareLink')}>
                                <Badge size="xs" variant="light" color="yellow" circle>!</Badge>
                              </Tooltip>
                            )}
                          </MGroup>
                          <MGroup gap={4} mt={2}>
                            {permLabels.map(l => (
                              <Badge key={l} size="xs" variant="light">{l}</Badge>
                            ))}
                          </MGroup>
                        </div>
                        <MGroup gap={4} wrap="nowrap">
                          <CopyButton value={url}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? t('copied') : t('copyLink')}>
                                <ActionIcon size="sm" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                                  {copied ? '✓' : '📋'}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                          <CloseButton size="sm" onClick={() => handleDeleteShareLink(link.code)} />
                        </MGroup>
                      </MGroup>
                    </Paper>
                  );
                })}
              </Stack>
            </>
          )}
        </Stack>
      </Modal>

      {/* Delete Expense Confirmation Modal */}
      <Modal opened={!!deleteExpenseId} onClose={() => setDeleteExpenseId(null)} title={t('confirmDeleteExpenseTitle', { defaultValue: 'Delete Expense' })} centered size="sm">
        <Stack gap="md">
          <Text size="sm">{t('confirmDeleteExpense', { defaultValue: 'Are you sure you want to delete this expense?' })}</Text>
          <MGroup justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setDeleteExpenseId(null)}>{t('cancel')}</Button>
            <Button color="red" onClick={() => deleteExpenseId && handleDeleteExpense(deleteExpenseId)}>{t('deleteExpense')}</Button>
          </MGroup>
        </Stack>
      </Modal>

      {/* Delete Group Confirmation Modal */}
      <Modal opened={deleteGroupModalOpened} onClose={closeDeleteGroupModal} title={t('deleteGroupTitle', { defaultValue: 'Delete Group' })} centered size="sm">
        <Stack gap="md">
          <Text size="sm" c="red" fw={600}>{t('deleteGroupIrreversible', { defaultValue: 'This action is irreversible. All expenses, members, and data will be permanently deleted.' })}</Text>
          <Text size="sm">{t('deleteGroupEnterName', { defaultValue: 'Type the group name "{{name}}" to confirm.', name: group.name })}</Text>
          <TextInput
            placeholder={group.name}
            value={deleteGroupConfirmName}
            onChange={(e) => setDeleteGroupConfirmName(e.target.value)}
          />
          <MGroup justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={closeDeleteGroupModal}>{t('cancel')}</Button>
            <Button color="red" disabled={deleteGroupConfirmName !== group.name} onClick={handleDeleteGroup}>{t('deleteGroup')}</Button>
          </MGroup>
        </Stack>
      </Modal>
    </Stack>
  );
}
