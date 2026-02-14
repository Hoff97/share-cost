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

  const formatBalance = (balance: number | undefined) => {
    if (balance === undefined) return null;
    const sign = balance >= 0 ? '+' : '';
    return `${sign}$${balance.toFixed(2)}`;
  };

  // Calculate total balance across all groups
  const totalBalance = groups.reduce((sum, group) => {
    return sum + (group.cachedBalance ?? 0);
  }, 0);

  const groupsWithIdentity = groups.filter(g => g.selectedMemberId);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="group-list">
      <h3>Your Groups</h3>
      
      {groupsWithIdentity.length > 0 && (
        <div className={`total-balance ${totalBalance >= 0 ? 'positive' : 'negative'}`}>
          <span>Total Balance:</span>
          <span className="total-amount">
            {totalBalance >= 0 ? '+' : ''}${totalBalance.toFixed(2)}
          </span>
        </div>
      )}

      <ul>
        {groups.map(group => (
          <li key={group.id} onClick={() => onSelectGroup(group.token)}>
            <div className="group-info">
              <span className="group-name">{group.name}</span>
              <span className="group-accessed">
                {group.selectedMemberName 
                  ? `You: ${group.selectedMemberName}` 
                  : 'Select yourself in group'}
              </span>
            </div>
            {group.cachedBalance !== undefined && (
              <span className={`group-balance ${group.cachedBalance >= 0 ? 'positive' : 'negative'}`}>
                {formatBalance(group.cachedBalance)}
              </span>
            )}
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
