import { useState, useEffect, useRef } from 'react';
import { Container, Title, Text, Button, Stack, Paper, Loader, Center, Group as MGroup, Alert, Badge, CloseButton } from '@mantine/core';
import * as api from './offlineApi';
import type { Group } from './offlineApi';
import { CreateGroup } from './components/CreateGroup';
import { GroupDetail } from './components/GroupDetail';
import { GroupList } from './components/GroupList';
import type { StoredGroup } from './storage';
import { getStoredGroups, saveGroup } from './storage';
import { SyncProvider, useSync } from './sync';

// Extract token from URL hash (used for share links)
const getTokenFromUrl = (): string | null => {
  const hash = window.location.hash;
  const match = hash.match(/^#token=(.+)$/);
  return match ? match[1] : null;
};

const clearTokenFromUrl = () => {
  window.history.replaceState({}, '', '/');
};

function SyncStatus() {
  const { isOnline, pendingCount, syncing } = useSync();
  if (isOnline && pendingCount === 0 && !syncing) return null;
  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', gap: 8, zIndex: 1000 }}>
      {!isOnline && <Badge color="orange" size="lg" variant="filled">📡 Offline</Badge>}
      {syncing && <Badge color="blue" size="lg" variant="filled">🔄 Syncing…</Badge>}
      {!syncing && pendingCount > 0 && (
        <Badge color="yellow" size="lg" variant="filled">
          ⏳ {pendingCount} pending
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
        style={{ background: 'var(--mantine-color-blue-0)', position: 'relative' }}>
        <CloseButton size="sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={handleDismiss} />
        <MGroup gap="sm" align="center" pr={24}>
          <Text size="lg">📲</Text>
          <div style={{ flex: 1 }}>
            <Text size="sm" fw={600}>Install Share Cost</Text>
            <Text size="xs" c="dimmed">Add to your home screen for offline access</Text>
          </div>
          <Button size="compact-sm" onClick={handleInstall}>Install</Button>
        </MGroup>
      </Paper>
    );
  }

  if (showIosHint) {
    return (
      <Paper shadow="sm" p="sm" radius="md" withBorder mb="md"
        style={{ background: 'var(--mantine-color-blue-0)', position: 'relative' }}>
        <CloseButton size="sm" style={{ position: 'absolute', top: 8, right: 8 }} onClick={handleDismiss} />
        <MGroup gap="sm" align="center" pr={24}>
          <Text size="lg">📲</Text>
          <div style={{ flex: 1 }}>
            <Text size="sm" fw={600}>Install Share Cost</Text>
            <Text size="xs" c="dimmed">
              Tap the share button <Text component="span" fw={700}>⬆</Text> then "Add to Home Screen"
            </Text>
          </div>
        </MGroup>
      </Paper>
    );
  }

  return null;
}

function AppContent() {
  const [group, setGroup] = useState<Group | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storedGroups, setStoredGroups] = useState<StoredGroup[]>([]);

  useEffect(() => {
    setStoredGroups(getStoredGroups());
    const urlToken = getTokenFromUrl();
    if (urlToken) {
      clearTokenFromUrl();
      setToken(urlToken);
      loadGroup(urlToken);
    } else {
      setLoading(false);
    }
    // Prefetch all stored groups in the background for offline access
    api.prefetchAllGroups();
  }, []);

  const loadGroup = async (authToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const groupData = await api.getGroup(authToken);
      if (groupData) {
        setGroup(groupData);
        saveGroup(groupData.id, groupData.name, authToken);
        setStoredGroups(getStoredGroups());
      } else {
        setError('Invalid or expired link');
      }
    } catch {
      setError('Failed to load group');
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

  if (loading) {
    return (
      <Container size="sm" py="xl">
        <Stack align="center" gap="md">
          <Title order={1}>💰 Share Cost</Title>
          <Center py="xl">
            <Loader size="lg" />
          </Center>
        </Stack>
      </Container>
    );
  }

  if (error) {
    return (
      <Container size="sm" py="xl">
        <Stack align="center" gap="md">
          <Title order={1}>💰 Share Cost</Title>
          <Alert color="red" title="Error" w="100%">
            {error}
          </Alert>
          <Button onClick={() => { setError(null); window.location.hash = ''; }}>
            Create a New Group
          </Button>
        </Stack>
      </Container>
    );
  }

  if (group && token) {
    return (
      <Container size="sm" py="xl">
        <MGroup justify="space-between" align="center" mb="lg">
          <Title order={1} style={{ cursor: 'pointer' }} onClick={handleBackToList}>💰 Share Cost</Title>
        </MGroup>
        <GroupDetail
          group={group}
          token={token}
          onGroupUpdated={refreshGroup}
        />
      </Container>
    );
  }

  return (
    <Container size="sm" py="xl">
      <Stack align="center" gap="md">
        <Title order={1}>💰 Share Cost</Title>
        <Text c="dimmed">Split expenses with friends, no sign-up required</Text>
      </Stack>
      <InstallBanner />
      {showCreate ? (
        <CreateGroup
          onGroupCreated={handleGroupCreated}
          onCancel={() => setShowCreate(false)}
        />
      ) : (
        <Paper shadow="xs" p="xl" mt="lg" radius="md">
          <Stack align="center" gap="md">
            <Text>Create a group to start tracking shared expenses.</Text>
            <Text>Share the link with your friends — anyone with the link can access the group.</Text>
            <Button size="lg" onClick={() => setShowCreate(true)}>
              Create New Group
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
