// Local storage for persisting group access across sessions

const STORAGE_KEY = 'share-cost-groups';

export interface StoredGroup {
  id: string;
  name: string;
  token: string;
  lastAccessed: string;
  selectedMemberId?: string;
  selectedMemberName?: string;
  cachedBalance?: number;
}

export const getStoredGroups = (): StoredGroup[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch {
    return [];
  }
};

export const saveGroup = (id: string, name: string, token: string): void => {
  const groups = getStoredGroups();
  const existingIndex = groups.findIndex(g => g.id === id);
  
  if (existingIndex >= 0) {
    // Preserve existing member selection and balance
    groups[existingIndex].name = name;
    groups[existingIndex].token = token;
    groups[existingIndex].lastAccessed = new Date().toISOString();
  } else {
    groups.push({
      id,
      name,
      token,
      lastAccessed: new Date().toISOString(),
    });
  }

  // Sort by last accessed (most recent first)
  groups.sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime());

  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
};

export const removeGroup = (id: string): void => {
  const groups = getStoredGroups().filter(g => g.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
};

export const updateGroupName = (id: string, name: string): void => {
  const groups = getStoredGroups();
  const group = groups.find(g => g.id === id);
  if (group) {
    group.name = name;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  }
};

export const setSelectedMember = (groupId: string, memberId: string, memberName: string): void => {
  const groups = getStoredGroups();
  const group = groups.find(g => g.id === groupId);
  if (group) {
    group.selectedMemberId = memberId;
    group.selectedMemberName = memberName;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  }
};

export const updateCachedBalance = (groupId: string, balance: number): void => {
  const groups = getStoredGroups();
  const group = groups.find(g => g.id === groupId);
  if (group) {
    group.cachedBalance = balance;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  }
};

export const getStoredGroup = (groupId: string): StoredGroup | undefined => {
  return getStoredGroups().find(g => g.id === groupId);
};

// Personal payment info stored in browser
const PAYMENT_INFO_KEY = 'share-cost-payment-info';

export interface StoredPaymentInfo {
  paypal_email: string | null;
  iban: string | null;
}

export const getStoredPaymentInfo = (): StoredPaymentInfo | null => {
  try {
    const data = localStorage.getItem(PAYMENT_INFO_KEY);
    if (!data) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
};

export const savePaymentInfo = (paypalEmail: string | null, iban: string | null): void => {
  localStorage.setItem(PAYMENT_INFO_KEY, JSON.stringify({ paypal_email: paypalEmail, iban: iban }));
};
