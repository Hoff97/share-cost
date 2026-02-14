import type { StoredGroup } from '../storage';
import { removeGroup } from '../storage';
import './GroupList.css';

interface GroupListProps {
  groups: StoredGroup[];
  onSelectGroup: (token: string) => void;
  onGroupRemoved: () => void;
}

export const GroupList = ({ groups, onSelectGroup, onGroupRemoved }: GroupListProps) => {
  const handleRemove = (e: React.MouseEvent, group: StoredGroup) => {
    e.stopPropagation();
    if (confirm(`Remove "${group.name}" from your list? You can rejoin using the share link.`)) {
      removeGroup(group.id);
      onGroupRemoved();
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="group-list">
      <h3>Your Groups</h3>
      <ul>
        {groups.map(group => (
          <li key={group.id} onClick={() => onSelectGroup(group.token)}>
            <div className="group-info">
              <span className="group-name">{group.name}</span>
              <span className="group-accessed">Last accessed: {formatDate(group.lastAccessed)}</span>
            </div>
            <button
              className="remove-btn"
              onClick={(e) => handleRemove(e, group)}
              title="Remove from list"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
