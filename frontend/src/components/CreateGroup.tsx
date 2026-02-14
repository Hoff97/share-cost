import { useState } from 'react';
import {
  Paper, Title, TextInput, Button, Stack, Pill, Group as MGroup,
} from '@mantine/core';
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
    <Paper shadow="xs" p="xl" mt="lg" radius="md" withBorder>
      <Title order={3} mb="md">Create New Group</Title>
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <TextInput
            label="Group Name"
            placeholder="e.g., Trip to Paris, Roommates"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div>
            <TextInput
              label="Members (at least 2)"
              placeholder="Enter member name"
              value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)}
              onKeyDown={handleKeyPress}
              rightSection={
                <Button size="compact-xs" variant="light" onClick={handleAddMember}>
                  Add
                </Button>
              }
              rightSectionWidth={60}
            />
            {members.length > 0 && (
              <MGroup gap="xs" mt="sm">
                {members.map((member) => (
                  <Pill
                    key={member}
                    withRemoveButton
                    onRemove={() => handleRemoveMember(member)}
                    size="md"
                  >
                    {member}
                  </Pill>
                ))}
              </MGroup>
            )}
          </div>

          <MGroup gap="sm" grow>
            <Button variant="default" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={!name || members.length < 2}>
              Create Group
            </Button>
          </MGroup>
        </Stack>
      </form>
    </Paper>
  );
}
