const API_BASE = 'http://localhost:8000/api';

export interface Member {
  id: string;
  name: string;
  paypal_email: string | null;
  iban: string | null;
}

export interface Group {
  id: string;
  name: string;
  members: Member[];
  created_at: string;
}

export interface GroupCreatedResponse {
  group: Group;
  token: string;
}

export interface Expense {
  id: string;
  group_id: string;
  description: string;
  amount: number;
  paid_by: string;
  split_between: string[];
  expense_type: string;
  transfer_to: string | null;
  created_at: string;
}

export interface Balance {
  user_id: string;
  user_name: string;
  balance: number;
}

// Helper to get auth headers
const authHeaders = (token: string): HeadersInit => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`,
});

// Group API
export const getGroup = async (token: string): Promise<Group | null> => {
  const res = await fetch(`${API_BASE}/groups/current`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return null;
  return res.json();
};

export const createGroup = async (name: string, memberNames: string[]): Promise<GroupCreatedResponse> => {
  const res = await fetch(`${API_BASE}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, member_names: memberNames }),
  });
  return res.json();
};

export const addMember = async (token: string, name: string): Promise<Group> => {
  const res = await fetch(`${API_BASE}/groups/current/members`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  return res.json();
};

// Expense API
export const getExpenses = async (token: string): Promise<Expense[]> => {
  const res = await fetch(`${API_BASE}/groups/current/expenses`, {
    headers: authHeaders(token),
  });
  return res.json();
};

export const createExpense = async (
  token: string,
  description: string,
  amount: number,
  paidBy: string,
  splitBetween: string[],
  expenseType: string = 'expense',
  transferTo?: string
): Promise<Expense> => {
  const res = await fetch(`${API_BASE}/groups/current/expenses`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      description,
      amount,
      paid_by: paidBy,
      split_between: splitBetween,
      expense_type: expenseType,
      transfer_to: transferTo || null,
    }),
  });
  return res.json();
};

// Balance API
export const getBalances = async (token: string): Promise<Balance[]> => {
  const res = await fetch(`${API_BASE}/groups/current/balances`, {
    headers: authHeaders(token),
  });
  return res.json();
};

// Member payment info
export const updateMemberPayment = async (
  token: string,
  memberId: string,
  paypalEmail: string | null,
  iban: string | null
): Promise<Member> => {
  const res = await fetch(`${API_BASE}/groups/current/members/${memberId}/payment`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ paypal_email: paypalEmail || null, iban: iban || null }),
  });
  return res.json();
};
