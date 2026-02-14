import { Title, Text, Card, Stack, Group as MGroup, Badge, ActionIcon, Paper } from '@mantine/core';
import type { StoredGroup } from '../storage';
import { removeGroup } from '../storage';

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

  const totalBalance = groups.reduce((sum, group) => {
    return sum + (group.cachedBalance ?? 0);
  }, 0);

  const groupsWithIdentity = groups.filter(g => g.selectedMemberId);

  if (groups.length === 0) {
    return null;
  }

  return (
    <Stack gap="sm" mt="xl" style={{ textAlign: 'left' }}>
      <Title order={4}>Your Groups</Title>

      {groupsWithIdentity.length > 0 && (
        <Paper
          p="sm"
          radius="md"
          bg={totalBalance >= 0 ? 'green.0' : 'red.0'}
        >
          <MGroup justify="space-between">
            <Text fw={600} c={totalBalance >= 0 ? 'green.8' : 'red.8'}>Total Balance:</Text>
            <Text fw={700} size="lg" c={totalBalance >= 0 ? 'green.8' : 'red.8'}>
              {totalBalance >= 0 ? '+' : ''}${totalBalance.toFixed(2)}
            </Text>
          </MGroup>
        </Paper>
      )}

      {groups.map(group => (
        <Card
          key={group.id}
          padding="sm"
          radius="md"
          withBorder
          onClick={() => onSelectGroup(group.token)}
          style={{ cursor: 'pointer', transition: 'transform 0.1s' }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateX(4px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')}
        >
          <MGroup justify="space-between" wrap="nowrap">
            <div style={{ flex: 1 }}>
              <Text fw={500}>{group.name}</Text>
              <Text size="xs" c="dimmed">
                {group.selectedMemberName
                  ? `You: ${group.selectedMemberName}`
                  : 'Select yourself in group'}
              </Text>
            </div>
            {group.cachedBalance !== undefined && (
              <Badge
                size="lg"
                variant="light"
                color={group.cachedBalance >= 0 ? 'green' : 'red'}
              >
                {group.cachedBalance >= 0 ? '+' : ''}${group.cachedBalance.toFixed(2)}
              </Badge>
            )}
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={(e) => handleRemove(e, group)}
              title="Remove from list"
            >
              ×
            </ActionIcon>
          </MGroup>
        </Card>
      ))}
    </Stack>
  );
};
