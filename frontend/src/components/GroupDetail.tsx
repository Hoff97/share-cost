import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { isPending } from '../offlineApi';
import { useSync } from '../sync';
import { getStoredGroup, getStoredGroups, setSelectedMember, updateCachedBalance, getStoredPaymentInfo, savePaymentInfo } from '../storage';

interface GroupDetailProps {
  group: Group;
  token: string;
  onGroupUpdated: () => void;
  onGroupDeleted?: () => void;
}

// Convert YYYY-MM-DD → DD.MM.YYYY for display
const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};
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
    const res = await fetch(`https://api.frankfurter.app/${date}?from=${from}&to=${to}`);
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
  const [editDescription, setEditDescription] = useState('');
  const [editAmount, setEditAmount] = useState<number | string>('');
  const [editPaidBy, setEditPaidBy] = useState<string | null>(null);
  const [editSplitBetween, setEditSplitBetween] = useState<string[]>([]);
  const [editExpenseType, setEditExpenseType] = useState('expense');
  const [editTransferTo, setEditTransferTo] = useState<string | null>(null);
  const [editExpenseDate, setEditExpenseDate] = useState<string | null>(null);
  const [expenseCurrency, setExpenseCurrency] = useState(group.currency);
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [splitType, setSplitType] = useState('equal');
  const [splitShares, setSplitShares] = useState<Record<string, number>>({});
  const [editExpenseCurrency, setEditExpenseCurrency] = useState('');
  const [editExchangeRate, setEditExchangeRate] = useState<number>(1);
  const [editSplitType, setEditSplitType] = useState('equal');
  const [editSplitShares, setEditSplitShares] = useState<Record<string, number>>({});
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

  const { syncVersion } = useSync();

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  // Auto-fetch exchange rate for edit form
  useEffect(() => {
    if (!editingExpenseId || editExpenseCurrency === group.currency) return;
    if (!editExpenseDate) return;
    let cancelled = false;
    fetchRate(editExpenseCurrency, group.currency, editExpenseDate).then(rate => {
      if (!cancelled && rate !== null) setEditExchangeRate(rate);
    });
    return () => { cancelled = true; };
  }, [editExpenseCurrency, editExpenseDate, group.currency, editingExpenseId]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !amount || !paidBy) return;
    if (expenseType === 'transfer' && !transferTo) return;
    if (expenseType !== 'transfer' && splitBetween.length === 0) return;

    await api.createExpense(
      token,
      group.id,
      description,
      typeof amount === 'string' ? parseFloat(amount) : amount,
      paidBy,
      splitBetween,
      expenseType,
      expenseType === 'transfer' ? (transferTo ?? undefined) : undefined,
      expenseDate || todayIso(),
      expenseCurrency,
      exchangeRate,
      splitType,
      splitType !== 'equal'
        ? splitBetween.map(id => ({ member_id: id, share: splitShares[id] ?? 0 }))
        : undefined,
    );

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
    loadData();
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

  const handleDeleteGroup = async () => {
    if (!confirm(t('confirmDeleteGroup'))) return;
    try {
      await api.deleteGroup(token);
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

  const handleStartEditExpense = (expense: Expense) => {
    setEditingExpenseId(expense.id);
    setEditDescription(expense.description);
    setEditAmount(expense.amount);
    setEditPaidBy(expense.paid_by);
    setEditSplitBetween(expense.split_between);
    setEditExpenseType(expense.expense_type);
    setEditTransferTo(expense.transfer_to);
    setEditExpenseDate(expense.expense_date);
    setEditExpenseCurrency(expense.currency);
    setEditExchangeRate(expense.exchange_rate);
    setEditSplitType(expense.split_type || 'equal');
    const shares: Record<string, number> = {};
    if (expense.splits) {
      for (const s of expense.splits) {
        if (s.share != null) shares[s.member_id] = s.share;
      }
    }
    setEditSplitShares(shares);
  };

  const handleCancelEditExpense = () => {
    setEditingExpenseId(null);
  };

  const handleSaveExpense = async () => {
    if (!editingExpenseId || !editDescription || !editAmount || !editPaidBy) return;
    if (editExpenseType === 'transfer' && !editTransferTo) return;
    if (editExpenseType !== 'transfer' && editSplitBetween.length === 0) return;

    await api.updateExpense(
      token,
      group.id,
      editingExpenseId,
      editDescription,
      typeof editAmount === 'string' ? parseFloat(editAmount) : editAmount,
      editPaidBy,
      editSplitBetween,
      editExpenseType,
      editExpenseType === 'transfer' ? (editTransferTo ?? undefined) : undefined,
      editExpenseDate || todayIso(),
      editExpenseCurrency,
      editExchangeRate,
      editSplitType,
      editSplitType !== 'equal'
        ? editSplitBetween.map(id => ({ member_id: id, share: editSplitShares[id] ?? 0 }))
        : undefined,
    );
    setEditingExpenseId(null);
    loadData();
  };

  const handleDeleteExpense = async (expenseId: string) => {
    await api.deleteExpense(token, group.id, expenseId);
    loadData();
  };

  const toggleEditSplitMember = (memberId: string) => {
    setEditSplitBetween((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  };

  const myBalance = selectedMemberId
    ? balances.find(b => b.user_id === selectedMemberId)
    : null;

  const memberOptions = group.members.map((m) => ({ value: m.id, label: m.name }));

  const [addEntryOpened, { toggle: toggleAddEntry, close: closeAddEntry }] = useDisclosure(false);
  const [expandedBalances, setExpandedBalances] = useState<Set<string>>(new Set());
  const [expandedExpenses, setExpandedExpenses] = useState<Set<string>>(new Set());

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

    // Debtors have negative balance (they owe money), creditors have positive (they are owed)
    const debtors: { id: string; name: string; amount: number }[] = [];
    const creditors: { id: string; name: string; amount: number }[] = [];

    for (const b of balances) {
      if (b.balance < -0.005) {
        debtors.push({ id: b.user_id, name: b.user_name, amount: Math.abs(b.balance) });
      } else if (b.balance > 0.005) {
        creditors.push({ id: b.user_id, name: b.user_name, amount: b.balance });
      }
    }

    // Sort both descending by amount for greedy matching
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const result: Settlement[] = [];
    let di = 0, ci = 0;

    while (di < debtors.length && ci < creditors.length) {
      const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
      if (transfer > 0.005) {
        result.push({
          from: debtors[di].id,
          fromName: debtors[di].name,
          to: creditors[ci].id,
          toName: creditors[ci].name,
          amount: Math.round(transfer * 100) / 100,
        });
      }
      debtors[di].amount -= transfer;
      creditors[ci].amount -= transfer;
      if (debtors[di].amount < 0.005) di++;
      if (creditors[ci].amount < 0.005) ci++;
    }

    return result;
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
      <Tabs defaultValue="expenses" variant="outline">
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
          {/* Collapsible Add Entry — only shown if user can add expenses */}
          {permissions.can_add_expenses && (
          <Paper shadow="xs" p="md" radius="md" withBorder mb="md">
            <MGroup
              justify="space-between"
              align="center"
              onClick={toggleAddEntry}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <Title order={4}>{t('addEntry')}</Title>
              <Text size="xl" c="dimmed" style={{ transition: 'transform 200ms', transform: addEntryOpened ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                ▾
              </Text>
            </MGroup>
            <Collapse in={addEntryOpened}>
              <Divider my="sm" />
              <form onSubmit={(e) => { handleAddExpense(e); closeAddEntry(); }}>
                <Stack gap="sm">
                  <SegmentedControl
                    fullWidth
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
                          <Text size="sm" fw={500} mt="sm" mb={4}>{t('splitMethod')}</Text>
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
                                const hasValues = prev !== 'equal' && Object.keys(splitShares).length > 0;
                                if (hasValues && totalAmt > 0) {
                                  // Convert existing values between percentage <-> exact
                                  if (prev === 'percentage' && val === 'exact') {
                                    setSplitShares(Object.fromEntries(splitBetween.map(id => [id, Math.round((splitShares[id] ?? 0) / 100 * totalAmt * 100) / 100])));
                                  } else if (prev === 'exact' && val === 'percentage') {
                                    setSplitShares(Object.fromEntries(splitBetween.map(id => [id, Math.round((splitShares[id] ?? 0) / totalAmt * 10000) / 100])));
                                  }
                                } else {
                                  // First time switching from equal — prefill with equal split
                                  const equalShare = val === 'percentage'
                                    ? Math.round(10000 / n) / 100
                                    : Math.round(totalAmt / n * 100) / 100;
                                  setSplitShares(Object.fromEntries(splitBetween.map(id => [id, equalShare])));
                                }
                              }
                            }}
                            data={[
                              { label: t('equal'), value: 'equal' },
                              { label: t('percentage'), value: 'percentage' },
                              { label: t('exact'), value: 'exact' },
                            ]}
                          />
                          {splitType !== 'equal' && (
                            <Stack gap={4} mt="xs">
                              {splitBetween.map(id => (
                                <Stack key={id} gap={2}>
                                  <MGroup gap="xs" align="center">
                                    <Text size="sm" style={{ flex: 1 }}>{getMemberName(id)}</Text>
                                    <NumberInput
                                      size="xs"
                                      w={100}
                                      min={0}
                                      step={splitType === 'percentage' ? 1 : 0.01}
                                      decimalScale={2}
                                      value={splitShares[id] ?? ''}
                                      onChange={(val) => setSplitShares(prev => ({ ...prev, [id]: typeof val === 'string' ? parseFloat(val) || 0 : val }))}
                                      rightSection={splitType === 'percentage' ? <Text size="xs">%</Text> : <Text size="xs">{cs(expenseCurrency)}</Text>}
                                    />
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
                              ))}
                              <Text size="xs" mt="md" c={
                                splitType === 'percentage'
                                  ? Math.abs(splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0) - 100) < 0.01 ? 'green' : 'red'
                                  : Math.abs(splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0) - (typeof amount === 'number' ? amount : parseFloat(amount as string) || 0)) < 0.01 ? 'green' : 'red'
                              }>
                                Total: {splitBetween.reduce((s, id) => s + (splitShares[id] ?? 0), 0).toFixed(2)}
                                {splitType === 'percentage' ? '% / 100%' : ` / ${typeof amount === 'number' ? amount.toFixed(2) : parseFloat(amount as string)?.toFixed(2) || '0.00'} ${cs(expenseCurrency)}`}
                              </Text>
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
                  <Button type="submit" fullWidth>
                    {expenseType === 'transfer' ? t('addTransfer') : expenseType === 'income' ? t('addIncome') : t('addExpense')}
                  </Button>
                </Stack>
              </form>
            </Collapse>
          </Paper>
          )}

          <Stack gap="xs">
            {expenses.length === 0 ? (
              <Text c="dimmed" ta="center" py="lg">{t('noExpenses')}</Text>
            ) : (
              expenses.map((expense) => (
                <Card
                  key={expense.id}
                  padding="sm"
                  radius="md"
                  withBorder
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: expense.expense_type === 'transfer'
                      ? 'var(--mantine-color-green-6)'
                      : expense.expense_type === 'income'
                      ? 'var(--mantine-color-yellow-6)'
                      : 'var(--mantine-color-blue-6)',
                  }}
                >
                  {editingExpenseId === expense.id ? (
                    /* Inline edit form */
                    <Stack gap="sm">
                      <SegmentedControl
                        fullWidth
                        value={editExpenseType}
                        onChange={(val) => {
                          setEditExpenseType(val);
                          if (val === 'transfer') setEditSplitBetween([]);
                          else setEditTransferTo(null);
                        }}
                        data={[
                          { label: t('expense'), value: 'expense' },
                          { label: t('transfer'), value: 'transfer' },
                          { label: t('income'), value: 'income' },
                        ]}
                      />
                      <TextInput
                        placeholder={t('description')}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                      <MGroup gap="xs">
                        <NumberInput
                          placeholder={t('amount')}
                          min={0}
                          step={0.01}
                          decimalScale={2}
                          value={editAmount}
                          onChange={setEditAmount}
                          leftSection={cs(editExpenseCurrency)}
                          style={{ flex: 1 }}
                        />
                        <Select
                          data={currencyData}
                          value={editExpenseCurrency}
                          onChange={(val) => val && setEditExpenseCurrency(val)}
                          w={90}
                          searchable
                        />
                      </MGroup>
                      {editExpenseCurrency !== group.currency && (
                        <MGroup gap="xs" align="flex-end">
                          <NumberInput
                            label={t('exchangeRateLabel', { from: editExpenseCurrency, to: group.currency })}
                            value={editExchangeRate}
                            onChange={(val) => setEditExchangeRate(typeof val === 'string' ? parseFloat(val) || 1 : val)}
                            decimalScale={6}
                            step={0.0001}
                            min={0}
                            size="xs"
                            style={{ flex: 1 }}
                          />
                          {typeof editAmount === 'number' && editAmount > 0 && (
                            <Text size="xs" c="dimmed" pb={2}>
                              ≈ {fmtAmt(editAmount * editExchangeRate, group.currency)}
                            </Text>
                          )}
                        </MGroup>
                      )}
                      <Select
                        placeholder={editExpenseType === 'transfer' ? t('fromWho') : editExpenseType === 'income' ? t('receivedBy') : t('whoPaid')}
                        data={memberOptions}
                        value={editPaidBy}
                        onChange={setEditPaidBy}
                        clearable
                      />
                      {editExpenseType === 'transfer' ? (
                        <Select
                          placeholder={t('toWho')}
                          data={memberOptions.filter(m => m.value !== editPaidBy)}
                          value={editTransferTo}
                          onChange={setEditTransferTo}
                          clearable
                        />
                      ) : (
                        <div>
                          <Text size="sm" fw={500} mb={4}>{t('splitBetween')}</Text>
                          <Stack gap={4}>
                            <Checkbox
                              label={t('everyone')}
                              fw={600}
                              checked={editSplitBetween.length === group.members.length}
                              indeterminate={editSplitBetween.length > 0 && editSplitBetween.length < group.members.length}
                              onChange={() =>
                                setEditSplitBetween(editSplitBetween.length === group.members.length ? [] : allMemberIds)
                              }
                            />
                            {group.members.map((member) => (
                              <Checkbox
                                key={member.id}
                                label={member.name}
                                checked={editSplitBetween.includes(member.id)}
                                onChange={() => toggleEditSplitMember(member.id)}
                                ml="md"
                              />
                            ))}
                          </Stack>
                          {editSplitBetween.length > 0 && (
                            <>
                              <Text size="sm" fw={500} mt="sm" mb={4}>{t('splitMethod')}</Text>
                              <SegmentedControl
                                fullWidth
                                size="xs"
                                value={editSplitType}
                                onChange={(val) => {
                                  const prev = editSplitType;
                                  setEditSplitType(val);
                                  if (val !== 'equal' && editSplitBetween.length > 0) {
                                    const n = editSplitBetween.length;
                                    const totalAmt = typeof editAmount === 'number' ? editAmount : parseFloat(editAmount as string) || 0;
                                    const hasValues = prev !== 'equal' && Object.keys(editSplitShares).length > 0;
                                    if (hasValues && totalAmt > 0) {
                                      if (prev === 'percentage' && val === 'exact') {
                                        setEditSplitShares(Object.fromEntries(editSplitBetween.map(id => [id, Math.round((editSplitShares[id] ?? 0) / 100 * totalAmt * 100) / 100])));
                                      } else if (prev === 'exact' && val === 'percentage') {
                                        setEditSplitShares(Object.fromEntries(editSplitBetween.map(id => [id, Math.round((editSplitShares[id] ?? 0) / totalAmt * 10000) / 100])));
                                      }
                                    } else {
                                      const equalShare = val === 'percentage'
                                        ? Math.round(10000 / n) / 100
                                        : Math.round(totalAmt / n * 100) / 100;
                                      setEditSplitShares(Object.fromEntries(editSplitBetween.map(id => [id, equalShare])));
                                    }
                                  }
                                }}
                                data={[
                                  { label: t('equal'), value: 'equal' },
                                  { label: t('percentage'), value: 'percentage' },
                                  { label: t('exact'), value: 'exact' },
                                ]}
                              />
                              {editSplitType !== 'equal' && (
                                <Stack gap={4} mt="xs">
                                  {editSplitBetween.map(id => (
                                    <Stack key={id} gap={2}>
                                      <MGroup gap="xs" align="center">
                                        <Text size="sm" style={{ flex: 1 }}>{getMemberName(id)}</Text>
                                        <NumberInput
                                          size="xs"
                                          w={100}
                                          min={0}
                                          step={editSplitType === 'percentage' ? 1 : 0.01}
                                          decimalScale={2}
                                          value={editSplitShares[id] ?? ''}
                                          onChange={(val) => setEditSplitShares(prev => ({ ...prev, [id]: typeof val === 'string' ? parseFloat(val) || 0 : val }))}
                                          rightSection={editSplitType === 'percentage' ? <Text size="xs">%</Text> : <Text size="xs">{cs(editExpenseCurrency)}</Text>}
                                        />
                                      </MGroup>
                                      {editSplitType === 'percentage' && (() => {
                                        const target = Math.max(0, Math.min(100, 100 - editSplitBetween.filter(o => o !== id).reduce((s, o) => s + (editSplitShares[o] ?? 0), 0)));
                                        return <Slider
                                          size="sm"
                                          min={0}
                                          max={100}
                                          step={0.5}
                                          value={editSplitShares[id] ?? 0}
                                          onChange={(val) => setEditSplitShares(prev => ({ ...prev, [id]: snapToMark(val, target, 100) }))}
                                          label={(v) => `${v}%`}
                                          marks={[{ value: target, label: `${target.toFixed(1)}%` }]}
                                        />;
                                      })()}
                                      {editSplitType === 'exact' && (() => {
                                        const totalAmt = typeof editAmount === 'number' ? editAmount : parseFloat(editAmount as string) || 0;
                                        const target = Math.max(0, Math.min(totalAmt, totalAmt - editSplitBetween.filter(o => o !== id).reduce((s, o) => s + (editSplitShares[o] ?? 0), 0)));
                                        return <Slider
                                          size="sm"
                                          min={0}
                                          max={totalAmt || 100}
                                          step={0.01}
                                          value={editSplitShares[id] ?? 0}
                                          onChange={(val) => setEditSplitShares(prev => ({ ...prev, [id]: Math.round(snapToMark(val, target, totalAmt || 100) * 100) / 100 }))}
                                          label={(v) => `${v.toFixed(2)}`}
                                          marks={[{ value: target, label: target.toFixed(2) }]}
                                        />;
                                      })()}
                                    </Stack>
                                  ))}
                                  <Text size="xs" mt="md" c={
                                    editSplitType === 'percentage'
                                      ? Math.abs(editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0) - 100) < 0.01 ? 'green' : 'red'
                                      : Math.abs(editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0) - (typeof editAmount === 'number' ? editAmount : parseFloat(editAmount as string) || 0)) < 0.01 ? 'green' : 'red'
                                  }>
                                    Total: {editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0).toFixed(2)}
                                    {editSplitType === 'percentage' ? '% / 100%' : ` / ${typeof editAmount === 'number' ? editAmount.toFixed(2) : parseFloat(editAmount as string)?.toFixed(2) || '0.00'} ${cs(editExpenseCurrency)}`}
                                  </Text>
                                </Stack>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      <DatePickerInput
                        label={t('date')}
                        placeholder={t('pickDate')}
                        size="xs"
                        value={editExpenseDate}
                        onChange={setEditExpenseDate}
                        locale="de"
                        valueFormat="DD.MM.YYYY"
                        clearable
                        maxDate={new Date()}
                      />
                      <MGroup gap="xs">
                        <Button size="compact-sm" onClick={handleSaveExpense}>{t('save')}</Button>
                        <Button size="compact-sm" variant="subtle" color="gray" onClick={handleCancelEditExpense}>{t('cancel')}</Button>
                      </MGroup>
                    </Stack>
                  ) : (
                    /* Display mode */
                    <>
                      <div style={{ cursor: 'pointer' }} onClick={() => toggleExpenseExpanded(expense.id)}>
                        <MGroup justify="space-between" align="center" mb={4}>
                          <MGroup gap="xs">
                            {isPending(expense) && (
                              <Badge size="sm" color="orange" variant="light">⏳ {t('pendingBadge')}</Badge>
                            )}
                            {expense.expense_type === 'transfer' && (
                              <Badge size="sm" color="green" variant="light">💸 {t('transferBadge')}</Badge>
                            )}
                            {expense.expense_type === 'income' && (
                              <Badge size="sm" color="yellow" variant="light">💰 {t('incomeBadge')}</Badge>
                            )}
                            <Text fw={600}>{expense.description}</Text>
                          </MGroup>
                          <MGroup gap={4} align="baseline">
                            <Text fw={700} c="blue" size="lg">{fmtAmt(expense.amount, expense.currency)}</Text>
                            {expense.currency !== group.currency && (
                              <Text size="xs" c="dimmed">≈ {fmtAmt(expense.amount * expense.exchange_rate, group.currency)}</Text>
                            )}
                            {!isPending(expense) && permissions.can_edit_expenses && (
                              <>
                                <ActionIcon size="sm" variant="subtle" color="gray" onClick={(e) => { e.stopPropagation(); handleStartEditExpense(expense); }}>
                                  <Text size="xs">✏️</Text>
                                </ActionIcon>
                                <ActionIcon size="sm" variant="subtle" color="red" onClick={(e) => { e.stopPropagation(); handleDeleteExpense(expense.id); }}>
                                  <Text size="xs">🗑️</Text>
                                </ActionIcon>
                              </>
                            )}
                          </MGroup>
                        </MGroup>
                        <Text size="sm" c="dimmed">
                          {expense.expense_type === 'transfer' ? (
                            <>{getMemberName(expense.paid_by)} → {expense.transfer_to ? getMemberName(expense.transfer_to) : t('unknown')}</>
                          ) : (
                            <>
                              {expense.expense_type === 'income' ? t('receivedByName', { name: getMemberName(expense.paid_by) }) : t('paidBy', { name: getMemberName(expense.paid_by) })}
                              {' · '}
                              {t('splitLabel')} {expense.split_between.map(getMemberName).join(', ')}
                            </>
                          )}
                          {' · '}
                          <Text component="span" size="xs" c="dimmed">{formatDate(expense.expense_date)}</Text>
                        </Text>
                      </div>
                      <Collapse in={expandedExpenses.has(expense.id)}>
                        <Divider my="xs" />
                        {expense.expense_type === 'transfer' ? (
                          <MGroup gap="xs">
                            <Text size="sm">{getMemberName(expense.paid_by)}</Text>
                            <Text size="sm" c="dimmed">→</Text>
                            <Text size="sm">{expense.transfer_to ? getMemberName(expense.transfer_to) : t('unknown')}</Text>
                            <Text size="sm" fw={600} c="blue">{fmtAmt(expense.amount, expense.currency)}</Text>
                          </MGroup>
                        ) : (
                          <Stack gap={4}>
                            <Text size="sm" fw={500} c="dimmed">
                              {expense.expense_type === 'income' ? t('receivedByName', { name: getMemberName(expense.paid_by) }) : t('paidBy', { name: getMemberName(expense.paid_by) })}
                              {expense.split_type && expense.split_type !== 'equal' && (
                                <Text component="span" size="xs" c="dimmed"> · {expense.split_type === 'percentage' ? t('percentSplit') : t('exactSplit')}</Text>
                              )}
                              {expense.currency !== group.currency && (
                                <Text component="span" size="xs" c="dimmed"> · {t('rateInfo', { from: expense.currency, rate: expense.exchange_rate.toFixed(4), to: group.currency })}</Text>
                              )}
                            </Text>
                            {expense.split_between.map(memberId => {
                              const splitEntry = expense.splits?.find(s => s.member_id === memberId);
                              let share: number;
                              if (expense.split_type === 'percentage' && splitEntry?.share != null) {
                                share = expense.amount * splitEntry.share / 100;
                              } else if (expense.split_type === 'exact' && splitEntry?.share != null) {
                                share = splitEntry.share;
                              } else {
                                share = expense.amount / expense.split_between.length;
                              }
                              const shareInGroup = share * expense.exchange_rate;
                              return (
                                <MGroup key={memberId} justify="space-between" px="xs">
                                  <Text size="sm">
                                    {getMemberName(memberId)}
                                    {expense.split_type === 'percentage' && splitEntry?.share != null && (
                                      <Text component="span" size="xs" c="dimmed"> ({splitEntry.share}%)</Text>
                                    )}
                                  </Text>
                                  <MGroup gap={4}>
                                    {expense.currency !== group.currency && (
                                      <Text size="xs" c="dimmed">{fmtAmt(share, expense.currency)} ≈</Text>
                                    )}
                                    <Text size="sm" fw={500} c="red">
                                      -{fmtAmt(shareInGroup, group.currency)}
                                    </Text>
                                  </MGroup>
                                </MGroup>
                              );
                            })}
                          </Stack>
                        )}
                      </Collapse>
                    </>
                  )}
                </Card>
              ))
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
              <Button color="red" variant="light" fullWidth onClick={handleDeleteGroup}>
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
                  return (
                    <Paper key={link.code} p="xs" withBorder radius="sm">
                      <MGroup justify="space-between" wrap="nowrap" gap="xs">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text size="xs" truncate="end" ff="monospace">{link.code}</Text>
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
    </Stack>
  );
}
