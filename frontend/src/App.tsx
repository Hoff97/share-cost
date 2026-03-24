import { useState, useEffect, useRef } from 'react';
import { Container, Title, Text, Button, Stack, Paper, Loader, Center, Group as MGroup, Alert, Badge, CloseButton, ActionIcon, useMantineColorScheme, useComputedColorScheme, Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './i18n';
import * as api from './offlineApi';
import type { Group } from './offlineApi';
import { CreateGroup } from './components/CreateGroup';
import { GroupDetail } from './components/GroupDetail';
import { GroupList } from './components/GroupList';
import type { StoredGroup } from './storage';
import { getStoredGroups, saveGroup, removeGroup, updateLastCheckedAt, setSelectedMember, getStoredGroup } from './storage';
import { SyncProvider, useSync } from './sync';

// Extract token from URL hash (used for old-style share links)
const getTokenFromUrl = (): string | null => {
  const hash = window.location.hash;
  const match = hash.match(/^#token=(.+)$/);
  return match ? match[1] : null;
};

// Extract share code from URL hash (used for new short share links)
const getShareCodeFromUrl = (): string | null => {
  const hash = window.location.hash;
  const match = hash.match(/^#join=([A-Za-z0-9]{16})$/);
  return match ? match[1] : null;
};

const clearHashFromUrl = () => {
  window.history.replaceState({}, '', '/');
};

function DarkModeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computedScheme = useComputedColorScheme('light');
  return (
    <ActionIcon
      variant="default"
      size="lg"
      onClick={() => setColorScheme(computedScheme === 'dark' ? 'light' : 'dark')}
      aria-label="Toggle dark mode"
    >
      {computedScheme === 'dark' ? '☀️' : '🌙'}
    </ActionIcon>
  );
}

function LanguageSelector({ i18n }: { i18n: { language: string; changeLanguage: (lng: string) => void } }) {
  const lang = i18n.language || 'en';
  const resolved = LANGUAGES.find(l => l.code === lang)?.code
    ?? LANGUAGES.find(l => l.code === lang.substring(0, 2))?.code
    ?? 'en';
  return (
    <Select
      size="xs"
      w={110}
      data={LANGUAGES.map(l => ({ value: l.code, label: l.label }))}
      value={resolved}
      onChange={(val) => val && i18n.changeLanguage(val)}
      allowDeselect={false}
      withCheckIcon={false}
      styles={{ input: { textAlign: 'center' } }}
    />
  );
}

function SyncStatus() {
  const { isOnline, pendingCount, syncing } = useSync();
  const { t } = useTranslation();
  if (isOnline && pendingCount === 0 && !syncing) return null;
  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', gap: 8, zIndex: 1000 }}>
      {!isOnline && <Badge color="orange" size="lg" variant="filled">{t('offline')}</Badge>}
      {syncing && <Badge color="blue" size="lg" variant="filled">{t('syncing')}</Badge>}
      {!syncing && pendingCount > 0 && (
        <Badge color="yellow" size="lg" variant="filled">
          {t('pending_count', { count: pendingCount })}
        </Badge>
      )}
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const INSTALL_DISMISSED_KEY = 'share-cost-install-dismissed';

function InstallBanner() {
  const { t } = useTranslation();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true');
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already installed as PWA or dismissed
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if ((navigator as unknown as { standalone?: boolean }).standalone) return;

    // Chrome / Edge / Samsung — capture the install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS Safari — no beforeinstallprompt, show manual hint
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);
    if (isIos || isSafari) {
      setShowIosHint(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!promptRef.current) return;
    await promptRef.current.prompt();
    const { outcome } = await promptRef.current.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
  };

  if (dismissed) return null;
  // Already in standalone mode
  if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) return null;

  if (deferredPrompt) {
    return (
      <Paper shadow="sm" p="sm" radius="md" withBorder mb="md"
        style={{ background: 'light-dark(var(--mantine-color-blue-0), var(--mantine-color-blue-9))', position: 'relative' }}>
        <CloseButton size="sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={handleDismiss} />
        <MGroup gap="sm" align="center" pr={24}>
          <Text size="lg">📲</Text>
          <div style={{ flex: 1 }}>
            <Text size="sm" fw={600}>{t('installTitle')}</Text>
            <Text size="xs" c="dimmed">{t('installDesc')}</Text>
          </div>
          <Button size="compact-sm" onClick={handleInstall}>{t('install')}</Button>
        </MGroup>
      </Paper>
    );
  }

  if (showIosHint) {
    return (
      <Paper shadow="sm" p="sm" radius="md" withBorder mb="md"
        style={{ background: 'light-dark(var(--mantine-color-blue-0), var(--mantine-color-blue-9))', position: 'relative' }}>
        <CloseButton size="sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={handleDismiss} />
        <MGroup gap="sm" align="center" pr={24}>
          <Text size="lg">📲</Text>
          <div style={{ flex: 1 }}>
            <Text size="sm" fw={600}>{t('installTitle')}</Text>
            <Text size="xs" c="dimmed">{t('installIosDesc')}</Text>
          </div>
        </MGroup>
      </Paper>
    );
  }

  return null;
}

function AppContent() {
  const { t, i18n } = useTranslation();
  const [group, setGroup] = useState<Group | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedGroups, setStoredGroups] = useState<StoredGroup[]>([]);

  useEffect(() => {
    setStoredGroups(getStoredGroups());
    const shareCode = getShareCodeFromUrl();
    const urlToken = getTokenFromUrl();
    if (shareCode) {
      clearHashFromUrl();
      redeemCode(shareCode);
    } else if (urlToken) {
      clearHashFromUrl();
      loadGroup(urlToken);
    } else {
      setLoading(false);
    }
    // Prefetch all stored groups in the background for offline access
    api.prefetchAllGroups().then(() => setStoredGroups(getStoredGroups()));
  }, []);

  // Auto-match user identity from other groups when entering a new group
  const autoMatchMember = (groupData: Group, groupId: string) => {
    // Skip if already has a selection for this group
    const existing = getStoredGroup(groupId);
    if (existing?.selectedMemberId) return;
    // Find a selectedMemberName from any other stored group
    const allStored = getStoredGroups();
    const knownName = allStored.find(g => g.id !== groupId && g.selectedMemberName)?.selectedMemberName;
    if (!knownName) return;
    const lower = knownName.toLowerCase();
    // Try exact match, then first-name match
    const exact = groupData.members.find(m => m.name.toLowerCase() === lower);
    if (exact) { setSelectedMember(groupId, exact.id, exact.name); return; }
    const firstName = lower.split(/\s+/)[0];
    const prefix = groupData.members.find(m => m.name.toLowerCase().split(/\s+/)[0] === firstName);
    if (prefix) { setSelectedMember(groupId, prefix.id, prefix.name); return; }
    const contains = groupData.members.find(m => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
    if (contains) { setSelectedMember(groupId, contains.id, contains.name); }
  };

  const redeemCode = async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      // Check if user already has a token for any group — we'll try each
      const stored = getStoredGroups();
      // We don't know the group_id yet, so pass all stored tokens and let the backend figure it out
      // Actually, just redeem first without existing token to get a token, then merge if needed
      const resp = await api.redeemShareCode(code);
      const authToken = resp.token;
      const groupData = await api.getGroup(authToken);
      if (groupData) {
        // Check if user already has a token for this group — merge if so
        let finalToken = authToken;
        const existing = stored.find(g => g.id === groupData.id);
        if (existing) {
          try {
            const merged = await api.redeemShareCode(code, existing.token);
            finalToken = merged.token;
          } catch {
            // Merge failed — keep the new token
          }
        }
        setGroup(groupData);
        setToken(finalToken);
        saveGroup(groupData.id, groupData.name, finalToken);
        autoMatchMember(groupData, groupData.id);
        setStoredGroups(getStoredGroups());
      } else {
        setError(t('invalidShareLink'));
      }
    } catch {
      setError(t('invalidShareLink'));
    }
    setLoading(false);
  };

  const loadGroup = async (authToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const groupData = await api.getGroup(authToken);
      if (groupData) {
        // If user already has a stored token for this group, merge permissions
        let finalToken = authToken;
        const existing = getStoredGroups().find(g => g.id === groupData.id);
        if (existing && existing.token !== authToken) {
          try {
            const merged = await api.mergeToken(authToken, existing.token);
            finalToken = merged.token;
          } catch {
            // Merge failed (e.g. old server) — keep the new token
          }
        }
        setGroup(groupData);
        setToken(finalToken);
        saveGroup(groupData.id, groupData.name, finalToken);
        setStoredGroups(getStoredGroups());
      } else {
        setError(t('invalidLink'));
      }
    } catch {
      setError(t('failedLoadGroup'));
    }
    setLoading(false);
  };

  const handleGroupCreated = (newGroup: Group, newToken: string) => {
    setGroup(newGroup);
    setToken(newToken);
    setShowCreate(false);
    saveGroup(newGroup.id, newGroup.name, newToken);
    setStoredGroups(getStoredGroups());
  };

  const handleSelectGroup = (groupToken: string) => {
    // Mark the group as checked when user opens it
    const sg = getStoredGroups().find(g => g.token === groupToken);
    if (sg) updateLastCheckedAt(sg.id);
    setToken(groupToken);
    loadGroup(groupToken);
  };

  const handleBackToList = () => {
    setGroup(null);
    setToken(null);
    setStoredGroups(getStoredGroups());
  };

  const refreshGroup = async () => {
    if (token) {
      const updated = await api.getGroup(token, group?.id);
      if (updated) setGroup(updated);
    }
  };

  const handleGroupDeleted = () => {
    if (group) removeGroup(group.id);
    setGroup(null);
    setToken(null);
    setStoredGroups(getStoredGroups());
  };

  if (loading) {
    return (
      <Container size="sm" py="xl">
        <MGroup justify="space-between" align="center" mb="md">
          <Title order={1}>{t('appTitle')}</Title>
          <MGroup gap="xs">
            <LanguageSelector i18n={i18n} />
            <DarkModeToggle />
          </MGroup>
        </MGroup>
        <Center py="xl">
          <Loader size="lg" />
        </Center>
      </Container>
    );
  }

  if (error) {
    return (
      <Container size="sm" py="xl">
        <MGroup justify="space-between" align="center" mb="md">
          <Title order={1}>{t('appTitle')}</Title>
          <MGroup gap="xs">
            <LanguageSelector i18n={i18n} />
            <DarkModeToggle />
          </MGroup>
        </MGroup>
        <Stack align="center" gap="md">
          <Alert color="red" title={t('error')} w="100%">
            {error}
          </Alert>
          <Button onClick={() => { setError(null); window.location.hash = ''; }}>
            {t('createNewGroup')}
          </Button>
        </Stack>
      </Container>
    );
  }

  if (group && token) {
    return (
      <Container size="sm" py="xl">
        <MGroup justify="space-between" align="center" mb="lg">
          <Title order={1} style={{ cursor: 'pointer' }} onClick={handleBackToList}>{t('appTitle')}</Title>
          <MGroup gap="xs">
            <LanguageSelector i18n={i18n} />
            <DarkModeToggle />
          </MGroup>
        </MGroup>
        <GroupDetail
          group={group}
          token={token}
          onGroupUpdated={refreshGroup}
          onGroupDeleted={handleGroupDeleted}
        />
      </Container>
    );
  }

  return (
    <Container size="sm" py="xl">
      <MGroup justify="space-between" align="center" mb="md">
        <Title order={1}>{t('appTitle')}</Title>
        <MGroup gap="xs">
          <LanguageSelector i18n={i18n} />
          <DarkModeToggle />
        </MGroup>
      </MGroup>
      <Text c="dimmed" ta="center">{t('tagline')}</Text>
      <InstallBanner />
      {showCreate ? (
        <CreateGroup
          onGroupCreated={handleGroupCreated}
          onCancel={() => setShowCreate(false)}
        />
      ) : (
        <Paper shadow="xs" p="xl" mt="lg" radius="md">
          <Stack align="center" gap="md">
            <Text>{t('createGroupPrompt')}</Text>
            <Text>{t('shareGroupPrompt')}</Text>
            <Button size="lg" onClick={() => setShowCreate(true)}>
              {t('createNewGroup')}
            </Button>
          </Stack>
          <GroupList
            groups={storedGroups}
            onSelectGroup={handleSelectGroup}
            onGroupRemoved={() => setStoredGroups(getStoredGroups())}
          />
        </Paper>
      )}
    </Container>
  );
}

function App() {
  return (
    <SyncProvider>
      <AppContent />
      <SyncStatus />
    </SyncProvider>
  );
}

export default App;
