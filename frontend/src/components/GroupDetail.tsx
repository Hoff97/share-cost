import { useState, useEffect, useCallback } from 'react';
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
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [splitBetween, setSplitBetween] = useState<string[]>([]);
  const [expenseType, setExpenseType] = useState<'expense' | 'transfer' | 'income'>('expense');
  const [transferTo, setTransferTo] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [showShareLink, setShowShareLink] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>(() => {
    const stored = getStoredGroup(group.id);
    return stored?.selectedMemberId;
  });

  const loadData = useCallback(async () => {
    const [expensesData, balancesData] = await Promise.all([
      api.getExpenses(token),
      api.getBalances(token),
    ]);
    setExpenses(expensesData);
    setBalances(balancesData);
    
    // Update cached balance for selected member
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
      parseFloat(amount),
      paidBy,
      splitBetween,
      expenseType,
      expenseType === 'transfer' ? transferTo : undefined
    );

    setDescription('');
    setAmount('');
    setPaidBy('');
    setSplitBetween([]);
    setExpenseType('expense');
    setTransferTo('');
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

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setShowShareLink(true);
    setTimeout(() => setShowShareLink(false), 2000);
  };

  const handleSelectMember = (memberId: string) => {
    const member = group.members.find(m => m.id === memberId);
    if (member) {
      setSelectedMemberId(memberId);
      setSelectedMember(group.id, memberId, member.name);
      // Update cached balance
      const myBalance = balances.find(b => b.user_id === memberId);
      if (myBalance) {
        updateCachedBalance(group.id, myBalance.balance);
      }
    }
  };

  const myBalance = selectedMemberId 
    ? balances.find(b => b.user_id === selectedMemberId)
    : null;

  return (
    <div className="group-detail">
      <div className="group-header">
        <h2>{group.name}</h2>
        <div className="header-actions">
          {selectedMemberId ? (
            <div className="identity-compact">
              <span className="identity-label">You:</span>
              <select 
                value={selectedMemberId} 
                onChange={(e) => handleSelectMember(e.target.value)}
                className="identity-select-compact"
              >
                {group.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              {myBalance && (
                <span className={`balance-badge ${myBalance.balance >= 0 ? 'positive' : 'negative'}`}>
                  {myBalance.balance >= 0 ? '+' : ''}${myBalance.balance.toFixed(2)}
                </span>
              )}
            </div>
          ) : (
            <select 
              value="" 
              onChange={(e) => handleSelectMember(e.target.value)}
              className="identity-select-prompt"
            >
              <option value="">Who are you?</option>
              {group.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={copyShareLink} className="share-btn">
            {showShareLink ? '✓ Copied!' : '🔗 Share'}
          </button>
        </div>
      </div>

      <section className="add-expense-section">
        <h3>Add Entry</h3>
        <form onSubmit={handleAddExpense}>
          <div className="expense-type-selector">
            <button type="button" className={`type-btn ${expenseType === 'expense' ? 'active' : ''}`} onClick={() => { setExpenseType('expense'); setTransferTo(''); }}>💳 Expense</button>
            <button type="button" className={`type-btn ${expenseType === 'transfer' ? 'active' : ''}`} onClick={() => { setExpenseType('transfer'); setSplitBetween([]); }}>💸 Transfer</button>
            <button type="button" className={`type-btn ${expenseType === 'income' ? 'active' : ''}`} onClick={() => { setExpenseType('income'); setTransferTo(''); }}>💰 Income</button>
          </div>
          <input
            type="text"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            type="number"
            placeholder="Amount"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">
              {expenseType === 'transfer' ? 'From who?' : expenseType === 'income' ? 'Received by?' : 'Who paid?'}
            </option>
            {group.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {expenseType === 'transfer' ? (
            <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
              <option value="">To who?</option>
              {group.members.filter(m => m.id !== paidBy).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="split-selection">
              <label>Split between:</label>
              {group.members.map((member) => (
                <label key={member.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={splitBetween.includes(member.id)}
                    onChange={() => toggleSplitMember(member.id)}
                  />
                  {member.name}
                </label>
              ))}
            </div>
          )}
          <button type="submit">
            {expenseType === 'transfer' ? 'Add Transfer' : expenseType === 'income' ? 'Add Income' : 'Add Expense'}
          </button>
        </form>
      </section>

      <section className="expenses-section">
        <h3>Expenses</h3>
        <div className="expenses-list">
          {expenses.length === 0 ? (
            <p className="no-expenses">No expenses yet. Add one above!</p>
          ) : (
            expenses.map((expense) => (
              <div key={expense.id} className={`expense-item ${expense.expense_type || 'expense'}`}>
                <div className="expense-header">
                  <div className="expense-title">
                    {expense.expense_type === 'transfer' && <span className="type-badge transfer">💸 Transfer</span>}
                    {expense.expense_type === 'income' && <span className="type-badge income">💰 Income</span>}
                    <span className="description">{expense.description}</span>
                  </div>
                  <span className="amount">${expense.amount.toFixed(2)}</span>
                </div>
                <div className="expense-details">
                  {expense.expense_type === 'transfer' ? (
                    <span>{getMemberName(expense.paid_by)} → {expense.transfer_to ? getMemberName(expense.transfer_to) : 'Unknown'}</span>
                  ) : (
                    <>
                      <span>{expense.expense_type === 'income' ? 'Received by' : 'Paid by'}: {getMemberName(expense.paid_by)}</span>
                      <span>
                        Split: {expense.split_between.map(getMemberName).join(', ')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="balances-section">
        <h3>Balances</h3>
        <div className="balances-list">
          {balances.map((balance) => (
            <div
              key={balance.user_id}
              className={`balance-item ${balance.balance >= 0 ? 'positive' : 'negative'} ${balance.user_id === selectedMemberId ? 'is-me' : ''}`}
            >
              <span className="name">
                {balance.user_name}
                {balance.user_id === selectedMemberId && <span className="me-tag"> (you)</span>}
              </span>
              <span className="amount">
                {balance.balance >= 0 ? '+' : ''}
                ${balance.balance.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="members-section">
        <h3>Members ({group.members.length})</h3>
        <div className="members-chips">
          {group.members.map((member) => (
            <span key={member.id} className={`member-chip ${member.id === selectedMemberId ? 'is-me' : ''}`}>
              {member.name}
            </span>
          ))}
        </div>
        <form onSubmit={handleAddMember} className="add-member-form">
          <input
            type="text"
            placeholder="Add new member..."
            value={newMemberName}
            onChange={(e) => setNewMemberName(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
      </section>
    </div>
  );
}
