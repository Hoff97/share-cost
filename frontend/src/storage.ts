// Local storage for persisting group access across sessions

const STORAGE_KEY = 'share-cost-groups';

export interface StoredGroup {
  id: string;
  name: string;
  token: string;
  lastAccessed: string;
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
  
  const storedGroup: StoredGroup = {
    id,
    name,
    token,
    lastAccessed: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    groups[existingIndex] = storedGroup;
  } else {
    groups.push(storedGroup);
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
