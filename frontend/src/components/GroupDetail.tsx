import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Paper, Title, Text, Button, TextInput, NumberInput, Select, Stack,
  Group as MGroup, SegmentedControl, Checkbox, Badge, Card,
  Divider, CopyButton, Tooltip, Collapse, Tabs, Anchor, ActionIcon,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { DatePickerInput } from '@mantine/dates';
import 'dayjs/locale/de';
import * as api from '../api';
import type { Group, Expense, Balance } from '../api';
import { getStoredGroup, getStoredGroups, setSelectedMember, updateCachedBalance, getStoredPaymentInfo, savePaymentInfo } from '../storage';

interface GroupDetailProps {
  group: Group;
  token: string;
  onGroupUpdated: () => void;
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

export function GroupDetail({ group, token, onGroupUpdated }: GroupDetailProps) {
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
  const [editExpenseCurrency, setEditExpenseCurrency] = useState('');
  const [editExchangeRate, setEditExchangeRate] = useState<number>(1);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(() => {
    const stored = getStoredGroup(group.id);
    return stored?.selectedMemberId ?? null;
  });

  const loadData = useCallback(async () => {
    const [expensesData, balancesData] = await Promise.all([
      api.getExpenses(token),
      api.getBalances(token),
    ]);
    setExpenses(expensesData);
    setBalances(balancesData);

    if (selectedMemberId) {
      const myBalance = balancesData.find(b => b.user_id === selectedMemberId);
      if (myBalance) {
        updateCachedBalance(group.id, myBalance.balance, group.currency);
      }
    }
  }, [token, selectedMemberId, group.id, group.currency]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
      description,
      typeof amount === 'string' ? parseFloat(amount) : amount,
      paidBy,
      splitBetween,
      expenseType,
      expenseType === 'transfer' ? (transferTo ?? undefined) : undefined,
      expenseDate || todayIso(),
      expenseCurrency,
      exchangeRate
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
    loadData();
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;

    await api.addMember(token, newMemberName.trim());
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
    await api.updateMemberPayment(token, memberId, editPaypal || null, editIban || null);
    // If editing own payment info, also save to browser for reuse in other groups
    if (memberId === selectedMemberId) {
      savePaymentInfo(editPaypal || null, editIban || null);
    }
    setEditingPayment(null);
    onGroupUpdated();
  };

  const shareUrl = `${window.location.origin}/#token=${token}`;

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
          await api.updateMemberPayment(token, memberId, stored.paypal_email, stored.iban);
          onGroupUpdated();
        }
      }
    }
  };

  const handleMarkReceived = async (fromId: string, fromName: string, toId: string, toName: string, amount: number) => {
    await api.createExpense(
      token,
      `Settlement: ${fromName} → ${toName}`,
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
      editingExpenseId,
      editDescription,
      typeof editAmount === 'string' ? parseFloat(editAmount) : editAmount,
      editPaidBy,
      editSplitBetween,
      editExpenseType,
      editExpenseType === 'transfer' ? (editTransferTo ?? undefined) : undefined,
      editExpenseDate || todayIso(),
      editExpenseCurrency,
      editExchangeRate
    );
    setEditingExpenseId(null);
    loadData();
  };

  const handleDeleteExpense = async (expenseId: string) => {
    await api.deleteExpense(token, expenseId);
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
    const targetGroup = await api.getGroup(targetStored.token);
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
    await api.createExpense(token, `Balance transferred to ${targetGroupName}`, amount, fromId, [], 'transfer', toId);
    // Create corresponding debt in target group
    await api.createExpense(targetGroupToken, `Balance transferred from ${group.name}`, amount, creditorInTargetId, [], 'transfer', myIdInTarget);

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
        <Title order={2}>{group.name}</Title>
        <MGroup gap="sm">
          {selectedMemberId ? (
            <MGroup gap="xs">
              <Text size="sm" c="dimmed">You:</Text>
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
                  variant="light"
                >
                  {myBalance.balance >= 0 ? '+' : ''}{fmtAmt(myBalance.balance, group.currency)}
                </Badge>
              )}
            </MGroup>
          ) : (
            <Select
              size="sm"
              placeholder="Who are you?"
              data={memberOptions}
              value={null}
              onChange={(val) => val && handleSelectMember(val)}
              w={160}
            />
          )}
          <CopyButton value={shareUrl}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied!' : 'Copy share link'}>
                <Button size="xs" color={copied ? 'teal' : 'green'} onClick={copy}>
                  {copied ? '✓ Copied!' : '🔗 Share'}
                </Button>
              </Tooltip>
            )}
          </CopyButton>
        </MGroup>
      </MGroup>

      {/* Tabs: Expenses / Balances / Members */}
      <Tabs defaultValue="expenses" variant="outline">
        <Tabs.List grow>
          <Tabs.Tab value="expenses">
            Expenses{expenses.length > 0 && ` (${expenses.length})`}
          </Tabs.Tab>
          <Tabs.Tab value="balances">
            Balances
          </Tabs.Tab>
          <Tabs.Tab value="members">
            Members ({group.members.length})
          </Tabs.Tab>
        </Tabs.List>

        {/* Expenses Tab */}
        <Tabs.Panel value="expenses" pt="md">
          {/* Collapsible Add Entry */}
          <Paper shadow="xs" p="md" radius="md" withBorder mb="md">
            <MGroup
              justify="space-between"
              align="center"
              onClick={toggleAddEntry}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <Title order={4}>Add Entry</Title>
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
                      { label: '💳 Expense', value: 'expense' },
                      { label: '💸 Transfer', value: 'transfer' },
                      { label: '💰 Income', value: 'income' },
                    ]}
                  />
                  <TextInput
                    placeholder="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <MGroup gap="xs">
                    <NumberInput
                      placeholder="Amount"
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
                        label={`1 ${expenseCurrency} = ? ${group.currency}`}
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
                    placeholder={expenseType === 'transfer' ? 'From who?' : expenseType === 'income' ? 'Received by?' : 'Who paid?'}
                    data={memberOptions}
                    value={paidBy}
                    onChange={setPaidBy}
                    clearable
                  />
                  {expenseType === 'transfer' ? (
                    <Select
                      placeholder="To who?"
                      data={memberOptions.filter(m => m.value !== paidBy)}
                      value={transferTo}
                      onChange={setTransferTo}
                      clearable
                    />
                  ) : (
                    <div>
                      <Text size="sm" fw={500} mb={4}>Split between:</Text>
                      <Stack gap={4}>
                        <Checkbox
                          label="Everyone"
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
                    </div>
                  )}
                  <DatePickerInput
                    label="Date"
                    placeholder="Pick a date"
                    value={expenseDate}
                    onChange={setExpenseDate}
                    locale="de"
                    valueFormat="DD.MM.YYYY"
                    clearable
                    maxDate={new Date()}
                  />
                  <Button type="submit" fullWidth>
                    {expenseType === 'transfer' ? 'Add Transfer' : expenseType === 'income' ? 'Add Income' : 'Add Expense'}
                  </Button>
                </Stack>
              </form>
            </Collapse>
          </Paper>

          <Stack gap="xs">
            {expenses.length === 0 ? (
              <Text c="dimmed" ta="center" py="lg">No expenses yet. Add one above!</Text>
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
                      ? 'var(--mantine-color-green-5)'
                      : expense.expense_type === 'income'
                      ? 'var(--mantine-color-yellow-5)'
                      : 'var(--mantine-color-blue-5)',
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
                          { label: '💳 Expense', value: 'expense' },
                          { label: '💸 Transfer', value: 'transfer' },
                          { label: '💰 Income', value: 'income' },
                        ]}
                      />
                      <TextInput
                        placeholder="Description"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                      <MGroup gap="xs">
                        <NumberInput
                          placeholder="Amount"
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
                            label={`1 ${editExpenseCurrency} = ? ${group.currency}`}
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
                        placeholder={editExpenseType === 'transfer' ? 'From who?' : editExpenseType === 'income' ? 'Received by?' : 'Who paid?'}
                        data={memberOptions}
                        value={editPaidBy}
                        onChange={setEditPaidBy}
                        clearable
                      />
                      {editExpenseType === 'transfer' ? (
                        <Select
                          placeholder="To who?"
                          data={memberOptions.filter(m => m.value !== editPaidBy)}
                          value={editTransferTo}
                          onChange={setEditTransferTo}
                          clearable
                        />
                      ) : (
                        <div>
                          <Text size="sm" fw={500} mb={4}>Split between:</Text>
                          <Stack gap={4}>
                            <Checkbox
                              label="Everyone"
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
                        </div>
                      )}
                      <DatePickerInput
                        label="Date"
                        placeholder="Pick a date"
                        size="xs"
                        value={editExpenseDate}
                        onChange={setEditExpenseDate}
                        locale="de"
                        valueFormat="DD.MM.YYYY"
                        clearable
                        maxDate={new Date()}
                      />
                      <MGroup gap="xs">
                        <Button size="compact-sm" onClick={handleSaveExpense}>Save</Button>
                        <Button size="compact-sm" variant="subtle" color="gray" onClick={handleCancelEditExpense}>Cancel</Button>
                      </MGroup>
                    </Stack>
                  ) : (
                    /* Display mode */
                    <>
                      <MGroup justify="space-between" align="center" mb={4}>
                        <MGroup gap="xs">
                          {expense.expense_type === 'transfer' && (
                            <Badge size="sm" color="green" variant="light">💸 Transfer</Badge>
                          )}
                          {expense.expense_type === 'income' && (
                            <Badge size="sm" color="yellow" variant="light">💰 Income</Badge>
                          )}
                          <Text fw={600}>{expense.description}</Text>
                        </MGroup>
                        <MGroup gap={4} align="baseline">
                          <Text fw={700} c="blue" size="lg">{fmtAmt(expense.amount, expense.currency)}</Text>
                          {expense.currency !== group.currency && (
                            <Text size="xs" c="dimmed">≈ {fmtAmt(expense.amount * expense.exchange_rate, group.currency)}</Text>
                          )}
                          <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => handleStartEditExpense(expense)}>
                            <Text size="xs">✏️</Text>
                          </ActionIcon>
                          <ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDeleteExpense(expense.id)}>
                            <Text size="xs">🗑️</Text>
                          </ActionIcon>
                        </MGroup>
                      </MGroup>
                      <Text size="sm" c="dimmed">
                        {expense.expense_type === 'transfer' ? (
                          <>{getMemberName(expense.paid_by)} → {expense.transfer_to ? getMemberName(expense.transfer_to) : 'Unknown'}</>
                        ) : (
                          <>
                            {expense.expense_type === 'income' ? 'Received by' : 'Paid by'}: {getMemberName(expense.paid_by)}
                            {' · '}
                            Split: {expense.split_between.map(getMemberName).join(', ')}
                          </>
                        )}
                        {' · '}
                        <Text component="span" size="xs" c="dimmed">{formatDate(expense.expense_date)}</Text>
                      </Text>
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
              <Paper p="sm" radius="md" bg="gray.0" mb="xs">
                <Text size="sm" c="dimmed" ta="center">
                  {settlements.length} transfer{settlements.length !== 1 ? 's' : ''} needed to settle all debts
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
                      borderColor: 'var(--mantine-color-blue-5)',
                      borderWidth: 2,
                      background: 'var(--mantine-color-blue-0)',
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
                          <Text component="span" c="blue" fw={500}> (you)</Text>
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
                              <Text size="sm" c="red">→ Pay</Text>
                              <Text size="sm" fw={500}>{o.name}</Text>
                              <Text size="sm" fw={600} c="red">{fmtAmt(o.amount, group.currency)}</Text>
                            </MGroup>
                            {recipient?.paypal_email && (
                              <MGroup gap="xs" ml="md" mt={2}>
                                <Badge size="xs" color="blue" variant="light">PayPal</Badge>
                                <Anchor
                                  size="xs"
                                  href={`https://paypal.me/${recipient.paypal_email}/${o.amount.toFixed(2).replace('.', ',')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Pay via PayPal →
                                </Anchor>
                              </MGroup>
                            )}
                            {recipient?.iban && (
                              <MGroup gap="xs" ml="md" mt={2}>
                                <Badge size="xs" color="gray" variant="light">IBAN</Badge>
                                <Text size="xs" ff="monospace">{recipient.iban}</Text>
                                <CopyButton value={recipient.iban}>
                                  {({ copied, copy }) => (
                                    <Tooltip label={copied ? 'Copied!' : 'Copy IBAN'}>
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
                                      placeholder="Select group"
                                      data={otherGroups.map(g => ({ value: g.id, label: g.name }))}
                                      value={crossGroupTransfer.targetGroupId}
                                      onChange={(val) => val && handleSelectTargetGroup(val)}
                                    />
                                    {crossGroupTransfer.loading && <Text size="xs" c="dimmed">Loading members...</Text>}
                                    {crossGroupTransfer.targetGroupMembers.length > 0 && (
                                      <>
                                        <Select
                                          size="xs"
                                          label={`Who is ${o.name} in ${crossGroupTransfer.targetGroupName}?`}
                                          placeholder="Select member"
                                          data={crossGroupTransfer.targetGroupMembers.map(m => ({ value: m.id, label: m.name }))}
                                          value={crossGroupTransfer.creditorInTargetId}
                                          onChange={(val) => setCrossGroupTransfer(prev => prev ? { ...prev, creditorInTargetId: val } : null)}
                                        />
                                        <Select
                                          size="xs"
                                          label={`Who is ${balance.user_name} in ${crossGroupTransfer.targetGroupName}?`}
                                          placeholder="Select member"
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
                                            Transfer {fmtAmt(o.amount, group.currency)}
                                          </Button>
                                          <Button
                                            size="compact-xs"
                                            variant="subtle"
                                            color="gray"
                                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setCrossGroupTransfer(null); }}
                                          >
                                            Cancel
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
                                    Transfer to another group →
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
                            <Text size="sm" c="green">← Receive from</Text>
                            <Text size="sm" fw={500}>{o.name}</Text>
                            <Text size="sm" fw={600} c="green">{fmtAmt(o.amount, group.currency)}</Text>
                          </MGroup>
                          <Tooltip label={`Record that ${o.name} paid ${balance.user_name}`}>
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="green"
                              onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleMarkReceived(o.id, o.name, balance.user_id, balance.user_name, o.amount); }}
                            >
                              ✓ Received
                            </Button>
                          </Tooltip>
                        </MGroup>
                      ))}
                      {!hasSettlements && (
                        <Text size="sm" c="dimmed">All settled up! 🎉</Text>
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
                  borderColor: 'var(--mantine-color-blue-5)',
                  borderWidth: 2,
                  background: 'var(--mantine-color-blue-0)',
                } : undefined}
              >
                <MGroup justify="space-between" align="center">
                  <Text fw={600}>
                    {member.name}
                    {member.id === selectedMemberId && (
                      <Text component="span" c="blue" fw={500}> (you)</Text>
                    )}
                  </Text>
                  <MGroup gap="xs">
                    {member.paypal_email && <Badge size="xs" color="blue" variant="light">PayPal</Badge>}
                    {member.iban && <Badge size="xs" color="gray" variant="light">IBAN</Badge>}
                    {editingPayment !== member.id && (
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
                        placeholder="PayPal email or PayPal.me username"
                        leftSection={<Text size="xs">💳</Text>}
                        value={editPaypal}
                        onChange={(e) => setEditPaypal(e.target.value)}
                      />
                      <TextInput
                        size="xs"
                        placeholder="IBAN"
                        leftSection={<Text size="xs">🏦</Text>}
                        value={editIban}
                        onChange={(e) => setEditIban(e.target.value)}
                      />
                      <MGroup gap="xs">
                        <Button size="compact-xs" onClick={() => handleSavePayment(member.id)}>Save</Button>
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setEditingPayment(null)}>Cancel</Button>
                      </MGroup>
                    </Stack>
                  </>
                )}
                {editingPayment !== member.id && (member.paypal_email || member.iban) && (
                  <>
                    <Divider my="xs" />
                    <Stack gap={2}>
                      {member.paypal_email && (
                        <Text size="xs" c="dimmed">PayPal: <Anchor href={`https://paypal.me/${member.paypal_email}`} target="_blank" rel="noopener noreferrer">{member.paypal_email}</Anchor></Text>
                      )}
                      {member.iban && (
                        <MGroup gap="xs">
                          <Text size="xs" c="dimmed">IBAN: {member.iban}</Text>
                          <CopyButton value={member.iban}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? 'Copied!' : 'Copy IBAN'}>
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
          <Divider my="sm" />
          <form onSubmit={handleAddMember}>
            <MGroup gap="xs">
              <TextInput
                placeholder="Add new member..."
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button type="submit" variant="light">Add</Button>
            </MGroup>
          </form>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
