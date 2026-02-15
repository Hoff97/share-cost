import { useState, useEffect } from 'react';
import { Container, Title, Text, Button, Stack, Paper, Loader, Center, Group as MGroup, Alert, Badge } from '@mantine/core';
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
