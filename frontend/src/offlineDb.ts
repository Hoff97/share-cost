// IndexedDB-based offline storage for group data and pending mutations

const DB_NAME = 'share-cost-offline';
const DB_VERSION = 1;

// Store names
const GROUPS_STORE = 'groups';       // Full group data keyed by group id
const EXPENSES_STORE = 'expenses';   // Expenses keyed by group id
const BALANCES_STORE = 'balances';   // Balances keyed by group id
const QUEUE_STORE = 'syncQueue';     // Pending mutations to sync

export interface QueuedMutation {
  id: number;
  timestamp: string;
  groupId: string;
  token: string;
  action: string;        // e.g. 'createExpense', 'updateExpense', 'deleteExpense', 'addMember', 'updatePayment'
  payload: unknown;       // The arguments for the API call
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GROUPS_STORE)) {
        db.createObjectStore(GROUPS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(EXPENSES_STORE)) {
        db.createObjectStore(EXPENSES_STORE, { keyPath: 'groupId' });
      }
      if (!db.objectStoreNames.contains(BALANCES_STORE)) {
        db.createObjectStore(BALANCES_STORE, { keyPath: 'groupId' });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generic get/put helpers
async function dbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName: string, key: string | number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// ─── Group data cache ────────────────────────────────────────────────────────

import type { Group, Expense, Balance } from './api';

export async function cacheGroup(group: Group): Promise<void> {
  await dbPut(GROUPS_STORE, group);
}

export async function getCachedGroup(groupId: string): Promise<Group | undefined> {
  return dbGet<Group>(GROUPS_STORE, groupId);
}

export async function cacheExpenses(groupId: string, expenses: Expense[]): Promise<void> {
  await dbPut(EXPENSES_STORE, { groupId, expenses });
}

export async function getCachedExpenses(groupId: string): Promise<Expense[]> {
  const record = await dbGet<{ groupId: string; expenses: Expense[] }>(EXPENSES_STORE, groupId);
  return record?.expenses ?? [];
}

export async function cacheBalances(groupId: string, balances: Balance[]): Promise<void> {
  await dbPut(BALANCES_STORE, { groupId, balances });
}

export async function getCachedBalances(groupId: string): Promise<Balance[]> {
  const record = await dbGet<{ groupId: string; balances: Balance[] }>(BALANCES_STORE, groupId);
  return record?.balances ?? [];
}

// ─── Mutation queue ──────────────────────────────────────────────────────────

export async function enqueueMutation(
  groupId: string,
  token: string,
  action: string,
  payload: unknown
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.add({
      timestamp: new Date().toISOString(),
      groupId,
      token,
      action,
      payload,
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingMutations(): Promise<QueuedMutation[]> {
  return dbGetAll<QueuedMutation>(QUEUE_STORE);
}

export async function removeMutation(id: number): Promise<void> {
  await dbDelete(QUEUE_STORE, id);
}

export async function getPendingCount(): Promise<number> {
  const all = await getPendingMutations();
  return all.length;
}
