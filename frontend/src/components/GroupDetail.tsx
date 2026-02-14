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
    if (!description || !amount || !paidBy || splitBetween.length === 0) return;

    await api.createExpense(
      token,
      description,
      parseFloat(amount),
      paidBy,
      splitBetween
    );

    setDescription('');
    setAmount('');
    setPaidBy('');
    setSplitBetween([]);
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
        <button onClick={copyShareLink} className="share-btn">
          {showShareLink ? '✓ Copied!' : '🔗 Share Link'}
        </button>
      </div>

      <section className="identity-section">
        <h3>Who are you?</h3>
        <div className="identity-select">
          <select 
            value={selectedMemberId || ''} 
            onChange={(e) => handleSelectMember(e.target.value)}
          >
            <option value="">Select yourself...</option>
            {group.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          {myBalance && (
            <div className={`my-balance ${myBalance.balance >= 0 ? 'positive' : 'negative'}`}>
              Your balance: {myBalance.balance >= 0 ? '+' : ''}${myBalance.balance.toFixed(2)}
            </div>
          )}
        </div>
      </section>

      <section className="members-section">
        <h3>Members ({group.members.length})</h3>
        <div className="members-chips">
          {group.members.map((member) => (
            <span key={member.id} className="member-chip">
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

      <section className="balances-section">
        <h3>Balances</h3>
        <div className="balances-list">
          {balances.map((balance) => (
            <div
              key={balance.user_id}
              className={`balance-item ${balance.balance >= 0 ? 'positive' : 'negative'}`}
            >
              <span className="name">{balance.user_name}</span>
              <span className="amount">
                {balance.balance >= 0 ? '+' : ''}
                ${balance.balance.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="add-expense-section">
        <h3>Add Expense</h3>
        <form onSubmit={handleAddExpense}>
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
            <option value="">Who paid?</option>
            {group.members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
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
          <button type="submit">Add Expense</button>
        </form>
      </section>

      <section className="expenses-section">
        <h3>Expenses</h3>
        <div className="expenses-list">
          {expenses.length === 0 ? (
            <p className="no-expenses">No expenses yet. Add one above!</p>
          ) : (
            expenses.map((expense) => (
              <div key={expense.id} className="expense-item">
                <div className="expense-header">
                  <span className="description">{expense.description}</span>
                  <span className="amount">${expense.amount.toFixed(2)}</span>
                </div>
                <div className="expense-details">
                  <span>Paid by: {getMemberName(expense.paid_by)}</span>
                  <span>
                    Split: {expense.split_between.map(getMemberName).join(', ')}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
