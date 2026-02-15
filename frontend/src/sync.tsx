import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as rawApi from './api';
import {
  getPendingMutations, removeMutation, getPendingCount,
  cacheGroup, cacheExpenses, cacheBalances,
  type QueuedMutation,
} from './offlineDb';

interface SyncContextValue {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  syncVersion: number;
  triggerSync: () => void;
}

const SyncContext = createContext<SyncContextValue>({
  isOnline: true,
  pendingCount: 0,
  syncing: false,
  syncVersion: 0,
  triggerSync: () => {},
});

export const useSync = () => useContext(SyncContext);

async function replayMutation(m: QueuedMutation): Promise<void> {
  const p = m.payload as Record<string, unknown>;
  switch (m.action) {
    case 'createExpense':
      await rawApi.createExpense(
        m.token,
        p.description as string,
        p.amount as number,
        p.paidBy as string,
        p.splitBetween as string[],
        p.expenseType as string,
        p.transferTo as string | undefined,
        p.expenseDate as string | undefined,
        p.currency as string | undefined,
        p.exchangeRate as number | undefined,
      );
      break;
    case 'updateExpense':
      await rawApi.updateExpense(
        m.token,
        p.expenseId as string,
        p.description as string,
        p.amount as number,
        p.paidBy as string,
        p.splitBetween as string[],
        p.expenseType as string,
        p.transferTo as string | undefined,
        p.expenseDate as string | undefined,
        p.currency as string | undefined,
        p.exchangeRate as number | undefined,
      );
      break;
    case 'deleteExpense':
      await rawApi.deleteExpense(m.token, p.expenseId as string);
      break;
    case 'addMember':
      await rawApi.addMember(m.token, p.name as string);
      break;
    case 'updatePayment':
      await rawApi.updateMemberPayment(
        m.token,
        p.memberId as string,
        p.paypalEmail as string | null,
        p.iban as string | null,
      );
      break;
  }
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const syncingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  const doSync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncing(true);

    try {
      const mutations = await getPendingMutations();
      const processedTokens = new Set<string>();

      for (const m of mutations) {
        try {
          await replayMutation(m);
          await removeMutation(m.id);
          processedTokens.add(m.token);
        } catch (err) {
          console.warn('Sync failed for mutation, will retry later:', m.action, err);
          break;
        }
      }

      // After replay, refresh server data for affected groups
      for (const token of processedTokens) {
        try {
          const group = await rawApi.getGroup(token);
          if (group) {
            await cacheGroup(group);
            const [expenses, balances] = await Promise.all([
              rawApi.getExpenses(token),
              rawApi.getBalances(token),
            ]);
            await cacheExpenses(group.id, expenses);
            await cacheBalances(group.id, balances);
          }
        } catch {
          /* will refresh next time */
        }
      }

      if (processedTokens.size > 0) {
        setSyncVersion(v => v + 1);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshPending();
    }
  }, [refreshPending]);

  // Initial pending count
  useEffect(() => { refreshPending(); }, [refreshPending]);

  // Online / offline events
  useEffect(() => {
    const goOnline = () => { setIsOnline(true); doSync(); };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [doSync]);

  // Listen for queued-mutation events dispatched by offlineApi
  useEffect(() => {
    const handler = () => refreshPending();
    window.addEventListener('share-cost-mutation-queued', handler);
    return () => window.removeEventListener('share-cost-mutation-queued', handler);
  }, [refreshPending]);

  const triggerSync = useCallback(() => { doSync(); }, [doSync]);

  return (
    <SyncContext.Provider value={{ isOnline, pendingCount, syncing, syncVersion, triggerSync }}>
      {children}
    </SyncContext.Provider>
  );
}
