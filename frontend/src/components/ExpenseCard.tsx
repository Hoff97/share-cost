import { useState } from 'react';
import {
  Text, Card, Badge, Collapse, Divider, Stack,
  Group as MGroup, SegmentedControl, TextInput, NumberInput, Select,
  Checkbox, Slider, ActionIcon,
  Button, Modal,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useTranslation } from 'react-i18next';
import type { Expense, SplitEntry, Member } from '../offlineApi';
import { isPending } from '../offlineApi';
import { getExpenseEmoji } from '../expenseEmoji';

// Currency helpers (shared with GroupDetail)
const SYM: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
const cs = (c: string) => SYM[c] || c;
const fmtAmt = (n: number, c: string) => {
  const s = SYM[c];
  const abs = Math.abs(n).toFixed(2);
  const sign = n < 0 ? '-' : '';
  return s ? `${sign}${s}${abs}` : `${sign}${abs} ${c}`;
};

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const CURRENCIES = [
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK',
  'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK',
  'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN',
  'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
];
const currencyData = CURRENCIES.map(c => ({ value: c, label: c }));

const snapToMark = (val: number, target: number, max: number) => {
  const threshold = max * 0.02;
  return Math.abs(val - target) < threshold ? target : val;
};

export interface ExpenseCardProps {
  expense: Expense;
  groupCurrency: string;
  members: Member[];
  selectedMemberId: string | null;
  canEdit: boolean;
  isEditing: boolean;
  isExpanded: boolean;
  isNew?: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: {
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
    splits?: SplitEntry[];
  }) => void;
  onDelete: () => void;
  onConvert?: () => void;
  onToggleExpand: () => void;
}

export function ExpenseCard({
  expense,
  groupCurrency,
  members,
  selectedMemberId,
  canEdit,
  isEditing,
  isExpanded,
  isNew,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onConvert,
  onToggleExpand,
}: ExpenseCardProps) {
  const { t } = useTranslation();

  const [showConvertModal, setShowConvertModal] = useState(false);

  // Edit state
  const [editDescription, setEditDescription] = useState(expense.description);
  const [editAmount, setEditAmount] = useState<number | string>(expense.amount);
  const [editPaidBy, setEditPaidBy] = useState<string | null>(expense.paid_by);
  const [editSplitBetween, setEditSplitBetween] = useState<string[]>(expense.split_between);
  const [editExpenseType, setEditExpenseType] = useState(expense.expense_type);
  const [editTransferTo, setEditTransferTo] = useState<string | null>(expense.transfer_to);
  const [editExpenseDate, setEditExpenseDate] = useState<string | null>(expense.expense_date);
  const [editExpenseCurrency, setEditExpenseCurrency] = useState(expense.currency);
  const [editExchangeRate, setEditExchangeRate] = useState<number>(expense.exchange_rate);
  const [editSplitType, setEditSplitType] = useState(expense.split_type || 'equal');
  const [editSplitShares, setEditSplitShares] = useState<Record<string, number>>(() => {
    const shares: Record<string, number> = {};
    if (expense.splits) {
      for (const s of expense.splits) {
        if (s.share != null) shares[s.member_id] = s.share;
      }
    }
    return shares;
  });

  const allMemberIds = members.map(m => m.id);
  const memberOptions = members.map(m => ({ value: m.id, label: m.name }));

  const getMemberName = (memberId: string) => members.find(m => m.id === memberId)?.name || 'Unknown';

  const toggleEditSplitMember = (memberId: string) => {
    setEditSplitBetween(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  // Validation: check all fields are filled, and splits sum correctly
  const editAmountNum = typeof editAmount === 'number' ? editAmount : parseFloat(editAmount as string) || 0;
  const isEditFormValid = (() => {
    if (!editDescription.trim() || editAmountNum <= 0 || !editPaidBy) return false;
    if (editExpenseType === 'transfer') return !!editTransferTo;
    if (editSplitBetween.length === 0) return false;
    if (editSplitType === 'percentage') {
      const total = editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0);
      return Math.abs(total - 100) < 0.01;
    }
    if (editSplitType === 'exact') {
      const total = editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0);
      return Math.abs(total - editAmountNum) < 0.01;
    }
    if (editSplitType === 'shares') {
      return editSplitBetween.some(id => (editSplitShares[id] ?? 0) > 0);
    }
    return true;
  })();

  const handleSave = () => {
    if (!isEditFormValid) return;

    onSaveEdit({
      description: editDescription,
      amount: typeof editAmount === 'string' ? parseFloat(editAmount) : editAmount,
      paidBy: editPaidBy!,
      splitBetween: editSplitBetween,
      expenseType: editExpenseType,
      transferTo: editExpenseType === 'transfer' ? (editTransferTo ?? undefined) : undefined,
      expenseDate: editExpenseDate || todayIso(),
      currency: editExpenseCurrency,
      exchangeRate: editExchangeRate,
      splitType: editSplitType,
      splits: editSplitType !== 'equal'
        ? editSplitBetween.map(id => ({ member_id: id, share: editSplitShares[id] ?? 0 }))
        : undefined,
    });
  };

  // Compute personal share
  const yourShare = (() => {
    if (!selectedMemberId) return null;
    if (expense.expense_type === 'transfer') {
      if (expense.paid_by === selectedMemberId) return -expense.amount * expense.exchange_rate;
      if (expense.transfer_to === selectedMemberId) return expense.amount * expense.exchange_rate;
      return null;
    }
    if (!expense.split_between.includes(selectedMemberId)) return null;
    const splitEntry = expense.splits?.find(s => s.member_id === selectedMemberId);
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
  })();

  const emoji = getExpenseEmoji(expense.description, expense.expense_type);

  return (
    <Card
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
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {isNew && (
        <div style={{
          position: 'absolute',
          top: -6,
          left: -6,
          background: 'var(--mantine-color-blue-6)',
          color: 'white',
          borderRadius: '999px',
          minWidth: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          padding: '0 5px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          zIndex: 1,
        }}>
          {t('newBadge')}
        </div>
      )}
      {isEditing ? (
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
          {editExpenseCurrency !== groupCurrency && (
            <MGroup gap="xs" align="flex-end">
              <NumberInput
                label={t('exchangeRateLabel', { from: editExpenseCurrency, to: groupCurrency })}
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
                  ≈ {fmtAmt(editAmount * editExchangeRate, groupCurrency)}
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
                  checked={editSplitBetween.length === members.length}
                  indeterminate={editSplitBetween.length > 0 && editSplitBetween.length < members.length}
                  onChange={() =>
                    setEditSplitBetween(editSplitBetween.length === members.length ? [] : allMemberIds)
                  }
                />
                {members.map(member => (
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
                        if (val === 'shares') {
                          setEditSplitShares(Object.fromEntries(editSplitBetween.map(id => [id, 10])));
                        } else {
                          const hasValues = prev !== 'equal' && prev !== 'shares' && Object.keys(editSplitShares).length > 0;
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
                      }
                    }}
                    data={[
                      { label: t('equal'), value: 'equal' },
                      { label: t('percentage'), value: 'percentage' },
                      { label: t('exact'), value: 'exact' },
                      { label: t('shares'), value: 'shares' },
                    ]}
                  />
                  {editSplitType !== 'equal' && (
                    <Stack gap={4} mt="xs">
                      {editSplitBetween.map(id => {
                        const totalSharesVal = editSplitType === 'shares' ? editSplitBetween.reduce((s, mid) => s + (editSplitShares[mid] ?? 0), 0) : 0;
                        const totalAmt = typeof editAmount === 'number' ? editAmount : parseFloat(editAmount as string) || 0;
                        const equivAmt = totalSharesVal > 0 ? totalAmt * (editSplitShares[id] ?? 0) / totalSharesVal : 0;
                        return (
                        <Stack key={id} gap={2}>
                          <MGroup gap="xs" align="center">
                            <Text size="sm" style={{ flex: 1 }}>{getMemberName(id)}</Text>
                            {editSplitType === 'shares' && (
                              <ActionIcon size="xs" variant="light" onClick={() => setEditSplitShares(prev => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) - 1) }))}>
                                <Text size="xs" fw={700}>−</Text>
                              </ActionIcon>
                            )}
                            <NumberInput
                              size="xs"
                              w={editSplitType === 'shares' ? 60 : 100}
                              min={0}
                              step={editSplitType === 'shares' ? 1 : editSplitType === 'percentage' ? 1 : 0.01}
                              decimalScale={editSplitType === 'shares' ? 0 : 2}
                              value={editSplitShares[id] ?? ''}
                              onChange={(val) => setEditSplitShares(prev => ({ ...prev, [id]: typeof val === 'string' ? parseFloat(val) || 0 : val }))}
                              rightSection={editSplitType === 'percentage' ? <Text size="xs">%</Text> : editSplitType === 'shares' ? <Text size="xs">×</Text> : <Text size="xs">{cs(editExpenseCurrency)}</Text>}
                            />
                            {editSplitType === 'shares' && (
                              <ActionIcon size="xs" variant="light" onClick={() => setEditSplitShares(prev => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))}>
                                <Text size="xs" fw={700}>+</Text>
                              </ActionIcon>
                            )}
                            {editSplitType === 'shares' && (
                              <Text size="xs" c="dimmed" w={70} ta="right">{fmtAmt(equivAmt, editExpenseCurrency)}</Text>
                            )}
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
                      );
                      })}
                      {editSplitType === 'shares' ? (
                        <Text size="xs" mt="md" c="dimmed">
                          {t('totalShares')}: {editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0)}
                        </Text>
                      ) : (
                        <Text size="xs" mt="md" c={
                          editSplitType === 'percentage'
                            ? Math.abs(editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0) - 100) < 0.01 ? 'green' : 'red'
                            : Math.abs(editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0) - (typeof editAmount === 'number' ? editAmount : parseFloat(editAmount as string) || 0)) < 0.01 ? 'green' : 'red'
                        }>
                          Total: {editSplitBetween.reduce((s, id) => s + (editSplitShares[id] ?? 0), 0).toFixed(2)}
                          {editSplitType === 'percentage' ? '% / 100%' : ` / ${typeof editAmount === 'number' ? editAmount.toFixed(2) : parseFloat(editAmount as string)?.toFixed(2) || '0.00'} ${cs(editExpenseCurrency)}`}
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
            size="xs"
            value={editExpenseDate}
            onChange={setEditExpenseDate}
            locale="de"
            valueFormat="DD.MM.YYYY"
            clearable
            maxDate={new Date()}
          />
          <MGroup gap="xs">
            <Button size="compact-sm" onClick={handleSave} disabled={!isEditFormValid}>{t('save')}</Button>
            <Button size="compact-sm" variant="subtle" color="gray" onClick={onCancelEdit}>{t('cancel')}</Button>
          </MGroup>
        </Stack>
      ) : (
        <>
          <div style={{ cursor: 'pointer' }} onClick={onToggleExpand}>
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
                <Text fw={600}>{emoji} {expense.description}</Text>
              </MGroup>
              <MGroup gap={4} align="baseline">
                <Text fw={700} c="blue" size="lg">{fmtAmt(expense.amount, expense.currency)}</Text>
                {expense.currency !== groupCurrency && (
                  <Text size="xs" c="dimmed">≈ {fmtAmt(expense.amount * expense.exchange_rate, groupCurrency)}</Text>
                )}
                {yourShare != null && (
                  <>
                    <Text size="sm" c="dimmed" fw={400}>/</Text>
                    <Text size="sm" c={yourShare >= 0 ? 'teal' : 'red'} fw={600}>
                      {fmtAmt(yourShare, groupCurrency)}
                    </Text>
                  </>
                )}
              </MGroup>
            </MGroup>
            <Collapse in={!isExpanded}>
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
            </Collapse>
            <Collapse in={isExpanded}>
              <Text size="sm" c="dimmed">{formatDate(expense.expense_date)}</Text>
            </Collapse>
          </div>
          <Collapse in={isExpanded}>
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
                    <Text component="span" size="xs" c="dimmed"> · {expense.split_type === 'percentage' ? t('percentSplit') : expense.split_type === 'shares' ? t('sharesSplit') : t('exactSplit')}</Text>
                  )}
                  {expense.currency !== groupCurrency && (
                    <Text component="span" size="xs" c="dimmed"> · {t('rateInfo', { from: expense.currency, rate: expense.exchange_rate.toFixed(4), to: groupCurrency })}</Text>
                  )}
                </Text>
                {expense.split_between.map(memberId => {
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
                  const shareInGroup = share * expense.exchange_rate;
                  return (
                    <MGroup key={memberId} justify="space-between" px="xs">
                      <Text size="sm">
                        {getMemberName(memberId)}
                        {expense.split_type === 'percentage' && splitEntry?.share != null && (
                          <Text component="span" size="xs" c="dimmed"> ({splitEntry.share}%)</Text>
                        )}
                        {expense.split_type === 'shares' && splitEntry?.share != null && (
                          <Text component="span" size="xs" c="dimmed"> ({splitEntry.share}×)</Text>
                        )}
                      </Text>
                      <MGroup gap={4}>
                        {expense.currency !== groupCurrency && (
                          <Text size="xs" c="dimmed">{fmtAmt(share, expense.currency)} ≈</Text>
                        )}
                        <Text size="sm" fw={500} c={expense.expense_type === 'income' ? 'teal' : 'red'}>
                          {expense.expense_type === 'income' ? '+' : '-'}{fmtAmt(shareInGroup, groupCurrency)}
                        </Text>
                      </MGroup>
                    </MGroup>
                  );
                })}
              </Stack>
            )}
            {!isPending(expense) && canEdit && (
              <>
                <Divider my="xs" />
                <MGroup gap="xs">
                  <Button size="compact-sm" variant="light" onClick={(e) => { e.stopPropagation(); onStartEdit(); }}>✏️ {t('editExpense')}</Button>
                  <Button size="compact-sm" variant="light" color="red" onClick={(e) => { e.stopPropagation(); onDelete(); }}>🗑️ {t('deleteExpense')}</Button>
                  {onConvert && (expense.expense_type === 'income' || expense.expense_type === 'transfer') && (
                    <Button size="compact-sm" variant="light" color="violet" onClick={(e) => { e.stopPropagation(); setShowConvertModal(true); }}>
                      🔄 {t('convert')}
                    </Button>
                  )}
                </MGroup>
              </>
            )}
          </Collapse>
        </>
      )}

      {/* Convert confirmation modal */}
      <Modal opened={showConvertModal} onClose={() => setShowConvertModal(false)} title={t('convertTitle')} centered size="sm">
        <Stack gap="sm">
          {expense.expense_type === 'income' ? (
            <>
              <Text size="sm">{t('convertIncomeToTransfersDesc', { count: expense.split_between.filter(id => id !== expense.paid_by).length })}</Text>
              <Stack gap={4}>
                {expense.split_between.filter(id => id !== expense.paid_by).map(memberId => {
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
                  return (
                    <Text key={memberId} size="sm" c="dimmed">
                      {getMemberName(memberId)} → {getMemberName(expense.paid_by)}: {fmtAmt(share, expense.currency)}
                    </Text>
                  );
                })}
              </Stack>
            </>
          ) : (
            <Text size="sm">{t('convertTransferToIncomeDesc', { from: getMemberName(expense.paid_by), to: getMemberName(expense.transfer_to || '') })}</Text>
          )}
          <MGroup justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setShowConvertModal(false)}>{t('cancel')}</Button>
            <Button color="violet" onClick={() => { setShowConvertModal(false); onConvert?.(); }}>{t('convert')}</Button>
          </MGroup>
        </Stack>
      </Modal>
    </Card>
  );
}
