import { useState } from 'react';
import * as api from '../api';
import type { Group } from '../api';

interface CreateGroupProps {
  onGroupCreated: (group: Group, token: string) => void;
  onCancel: () => void;
}

export function CreateGroup({ onGroupCreated, onCancel }: CreateGroupProps) {
  const [name, setName] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>([]);

  const handleAddMember = () => {
    const trimmed = memberInput.trim();
    if (trimmed && !members.includes(trimmed)) {
      setMembers([...members, trimmed]);
      setMemberInput('');
    }
  };

  const handleRemoveMember = (memberName: string) => {
    setMembers(members.filter((m) => m !== memberName));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddMember();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || members.length < 2) return;

    const response = await api.createGroup(name, members);
    onGroupCreated(response.group, response.token);
  };

  return (
    <div className="create-group">
      <h2>Create New Group</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="groupName">Group Name</label>
          <input
            id="groupName"
            type="text"
            placeholder="e.g., Trip to Paris, Roommates"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Members (at least 2)</label>
          <div className="member-input-row">
            <input
              type="text"
              placeholder="Enter member name"
              value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <button type="button" onClick={handleAddMember} className="add-btn">
              Add
            </button>
          </div>
          
          {members.length > 0 && (
            <div className="members-list">
              {members.map((member) => (
                <span key={member} className="member-tag">
                  {member}
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member)}
                    className="remove-btn"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="button-row">
          <button type="button" onClick={onCancel} className="cancel-btn">
            Cancel
          </button>
          <button type="submit" disabled={!name || members.length < 2}>
            Create Group
          </button>
        </div>
      </form>
    </div>
  );
}
