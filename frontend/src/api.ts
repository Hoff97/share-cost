const API_BASE = '/api';

export interface Member {
  id: string;
  name: string;
  paypal_email: string | null;
  iban: string | null;
}

export interface Group {
  id: string;
  name: string;
  currency: string;
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
  currency: string;
  exchange_rate: number;
  expense_date: string;
  created_at: string;
}

export interface Balance {
  user_id: string;
  user_name: string;
  balance: number;
}

export interface Permissions {
  can_delete_group: boolean;
  can_manage_members: boolean;
  can_update_payment: boolean;
  can_add_expenses: boolean;
  can_edit_expenses: boolean;
}

export interface ShareLinkResponse {
  token: string;
  permissions: Permissions;
}

export interface ShareCodeResponse {
  code: string;
  permissions: Permissions;
}

export interface ShareLinkItem {
  code: string;
  can_delete_group: boolean;
  can_manage_members: boolean;
  can_update_payment: boolean;
  can_add_expenses: boolean;
  can_edit_expenses: boolean;
  created_at: string;
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

export const createGroup = async (name: string, memberNames: string[], currency?: string): Promise<GroupCreatedResponse> => {
  const res = await fetch(`${API_BASE}/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, member_names: memberNames, currency: currency || null }),
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
  transferTo?: string,
  expenseDate?: string,
  currency?: string,
  exchangeRate?: number
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
      expense_date: expenseDate || null,
      currency: currency || null,
      exchange_rate: exchangeRate ?? null,
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

// Update expense
export const updateExpense = async (
  token: string,
  expenseId: string,
  description: string,
  amount: number,
  paidBy: string,
  splitBetween: string[],
  expenseType: string = 'expense',
  transferTo?: string,
  expenseDate?: string,
  currency?: string,
  exchangeRate?: number
): Promise<Expense> => {
  const res = await fetch(`${API_BASE}/groups/current/expenses/${expenseId}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({
      description,
      amount,
      paid_by: paidBy,
      split_between: splitBetween,
      expense_type: expenseType,
      transfer_to: transferTo || null,
      expense_date: expenseDate || null,
      currency: currency || null,
      exchange_rate: exchangeRate ?? null,
    }),
  });
  return res.json();
};

// Delete expense
export const deleteExpense = async (
  token: string,
  expenseId: string
): Promise<void> => {
  await fetch(`${API_BASE}/groups/current/expenses/${expenseId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
};

// Get current token's permissions
export const getPermissions = async (token: string): Promise<Permissions> => {
  const res = await fetch(`${API_BASE}/groups/current/permissions`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    // Old servers without permissions endpoint → assume all
    return {
      can_delete_group: true,
      can_manage_members: true,
      can_update_payment: true,
      can_add_expenses: true,
      can_edit_expenses: true,
    };
  }
  return res.json();
};

// Generate a share link with selected permissions (returns a short code)
export const generateShareLink = async (
  token: string,
  permissions: Partial<Permissions>
): Promise<ShareCodeResponse> => {
  const res = await fetch(`${API_BASE}/groups/current/share`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(permissions),
  });
  return res.json();
};

// Redeem a share code for a JWT token (no auth required)
export const redeemShareCode = async (
  code: string,
  existingToken?: string
): Promise<ShareLinkResponse> => {
  const res = await fetch(`${API_BASE}/share/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, existing_token: existingToken ?? null }),
  });
  if (!res.ok) throw new Error('Invalid or expired share code');
  return res.json();
};

// Merge two tokens for the same group (union of permissions)
export const mergeToken = async (
  token: string,
  otherToken: string
): Promise<ShareLinkResponse> => {
  const res = await fetch(`${API_BASE}/groups/current/merge-token`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ other_token: otherToken }),
  });
  if (!res.ok) throw new Error('Failed to merge tokens');
  return res.json();
};

// List all share links for the current group
export const listShareLinks = async (token: string): Promise<ShareLinkItem[]> => {
  const res = await fetch(`${API_BASE}/groups/current/share-links`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return [];
  return res.json();
};

// Delete a share link by code
export const deleteShareLink = async (token: string, code: string): Promise<void> => {
  await fetch(`${API_BASE}/groups/current/share-links/${code}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
};

// Delete group
export const deleteGroup = async (token: string): Promise<void> => {
  await fetch(`${API_BASE}/groups/current`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
};
