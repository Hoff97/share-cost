import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Paper, Title, Text, Button, TextInput, NumberInput, Select, Stack,
  Group as MGroup, SegmentedControl, Checkbox, Badge, Card, Pill,
  Divider, CopyButton, Tooltip, Collapse, Tabs,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import * as api from '../api';
import type { Group, Expense, Balance } from '../api';
import { getStoredGroup, setSelectedMember, updateCachedBalance } from '../storage';

interface GroupDetailProps {
  group: Group;
  token: string;
  onGroupUpdated: () => void;
}

export function GroupDetail({ group, token, onGroupUpdated }: GroupDetailProps) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | string>('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [splitBetween, setSplitBetween] = useState<string[]>([]);
  const [expenseType, setExpenseType] = useState('expense');
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState('');
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
        updateCachedBalance(group.id, myBalance.balance);
      }
    }
  }, [token, selectedMemberId, group.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
      expenseType === 'transfer' ? (transferTo ?? undefined) : undefined
    );

    setDescription('');
    setAmount('');
    setPaidBy(null);
    setSplitBetween([]);
    setExpenseType('expense');
    setTransferTo(null);
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

  const shareUrl = `${window.location.origin}/#token=${token}`;

  const handleSelectMember = (memberId: string) => {
    const member = group.members.find(m => m.id === memberId);
    if (member) {
      setSelectedMemberId(memberId);
      setSelectedMember(group.id, memberId, member.name);
      const myBalance = balances.find(b => b.user_id === memberId);
      if (myBalance) {
        updateCachedBalance(group.id, myBalance.balance);
      }
    }
  };

  const myBalance = selectedMemberId
    ? balances.find(b => b.user_id === selectedMemberId)
    : null;

  const memberOptions = group.members.map((m) => ({ value: m.id, label: m.name }));

  const [addEntryOpened, { toggle: toggleAddEntry, close: closeAddEntry }] = useDisclosure(false);
  const [expandedBalances, setExpandedBalances] = useState<Set<string>>(new Set());

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
    const owes: { name: string; amount: number }[] = [];
    const owedBy: { name: string; amount: number }[] = [];
    for (const s of settlements) {
      if (s.from === userId) owes.push({ name: s.toName, amount: s.amount });
      if (s.to === userId) owedBy.push({ name: s.fromName, amount: s.amount });
    }
    return { owes, owedBy };
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
                  {myBalance.balance >= 0 ? '+' : ''}${myBalance.balance.toFixed(2)}
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
                      if (val === 'transfer') setSplitBetween([]);
                      else setTransferTo(null);
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
                  <NumberInput
                    placeholder="Amount"
                    min={0}
                    step={0.01}
                    decimalScale={2}
                    value={amount}
                    onChange={setAmount}
                    leftSection="$"
                  />
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
                        {group.members.map((member) => (
                          <Checkbox
                            key={member.id}
                            label={member.name}
                            checked={splitBetween.includes(member.id)}
                            onChange={() => toggleSplitMember(member.id)}
                          />
                        ))}
                      </Stack>
                    </div>
                  )}
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
                    <Text fw={700} c="blue" size="lg">${expense.amount.toFixed(2)}</Text>
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
                  </Text>
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
                      {balance.balance >= 0 ? '+' : ''}${balance.balance.toFixed(2)}
                    </Text>
                  </MGroup>
                  <Collapse in={isExpanded}>
                    <Divider my="xs" />
                    <Stack gap={4}>
                      {owes.map((o, i) => (
                        <MGroup key={`owe-${i}`} gap="xs">
                          <Text size="sm" c="red">→ Pay</Text>
                          <Text size="sm" fw={500}>{o.name}</Text>
                          <Text size="sm" fw={600} c="red">${o.amount.toFixed(2)}</Text>
                        </MGroup>
                      ))}
                      {owedBy.map((o, i) => (
                        <MGroup key={`owed-${i}`} gap="xs">
                          <Text size="sm" c="green">← Receive from</Text>
                          <Text size="sm" fw={500}>{o.name}</Text>
                          <Text size="sm" fw={600} c="green">${o.amount.toFixed(2)}</Text>
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
          <MGroup gap="xs" mb="sm">
            {group.members.map((member) => (
              <Pill
                key={member.id}
                size="md"
                style={member.id === selectedMemberId ? {
                  background: 'var(--mantine-color-blue-5)',
                  color: 'white',
                } : undefined}
              >
                {member.name}
              </Pill>
            ))}
          </MGroup>
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
