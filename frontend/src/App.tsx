import { useState, useEffect } from 'react';
import './App.css';
import * as api from './api';
import type { Group } from './api';
import { CreateGroup } from './components/CreateGroup';
import { GroupDetail } from './components/GroupDetail';
import { GroupList } from './components/GroupList';
import type { StoredGroup } from './storage';
import { getStoredGroups, saveGroup } from './storage';

// Extract token from URL hash (used for share links)
const getTokenFromUrl = (): string | null => {
  const hash = window.location.hash;
  const match = hash.match(/^#token=(.+)$/);
  return match ? match[1] : null;
};

const clearTokenFromUrl = () => {
  window.history.replaceState({}, '', '/');
};

function App() {
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
      // Clear token from URL immediately for security
      clearTokenFromUrl();
      setToken(urlToken);
      loadGroup(urlToken);
    } else {
      setLoading(false);
    }
  }, []);

  const loadGroup = async (authToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const groupData = await api.getGroup(authToken);
      if (groupData) {
        setGroup(groupData);
        // Save to local storage
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
    // Save to local storage (token is stored here, not in URL)
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
      const updated = await api.getGroup(token);
      if (updated) setGroup(updated);
    }
  };

  if (loading) {
    return (
      <div className="app">
        <header>
          <h1>💰 Share Cost</h1>
        </header>
        <main className="loading">
          <p>Loading...</p>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <header>
          <h1>💰 Share Cost</h1>
        </header>
        <main className="error">
          <p>{error}</p>
          <button onClick={() => { setError(null); window.location.hash = ''; }}>
            Create a New Group
          </button>
        </main>
      </div>
    );
  }

  if (group && token) {
    return (
      <div className="app">
        <header>
          <h1>💰 Share Cost</h1>
          {storedGroups.length > 0 && (
            <button className="back-btn" onClick={handleBackToList}>
              ← All Groups
            </button>
          )}
        </header>
        <main>
          <GroupDetail
            group={group}
            token={token}
            onGroupUpdated={refreshGroup}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>💰 Share Cost</h1>
        <p className="tagline">Split expenses with friends, no sign-up required</p>
      </header>
      <main>
        {showCreate ? (
          <CreateGroup
            onGroupCreated={handleGroupCreated}
            onCancel={() => setShowCreate(false)}
          />
        ) : (
          <div className="welcome">
            <p>Create a group to start tracking shared expenses.</p>
            <p>Share the link with your friends - anyone with the link can access the group.</p>
            <button onClick={() => setShowCreate(true)} className="create-btn">
              Create New Group
            </button>
            <GroupList
              groups={storedGroups}
              onSelectGroup={handleSelectGroup}
              onGroupRemoved={() => setStoredGroups(getStoredGroups())}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
