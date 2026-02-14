import { Title, Text, Card, Stack, Group as MGroup, Badge, ActionIcon, Paper } from '@mantine/core';
import type { StoredGroup } from '../storage';
import { removeGroup } from '../storage';

const SYM: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
const fmtAmt = (n: number, c?: string) => {
  const cur = c || 'EUR';
  const s = SYM[cur];
  const abs = Math.abs(n).toFixed(2);
  const sign = n >= 0 ? '+' : '-';
  return s ? `${sign}${s}${abs}` : `${sign}${abs} ${cur}`;
};

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

  const groupsWithIdentity = groups.filter(g => g.selectedMemberId);

  // Group balances by currency
  const balanceByCurrency: Record<string, number> = {};
  for (const g of groupsWithIdentity) {
    const cur = g.cachedCurrency || 'EUR';
    balanceByCurrency[cur] = (balanceByCurrency[cur] ?? 0) + (g.cachedBalance ?? 0);
  }
  const currencyEntries = Object.entries(balanceByCurrency);

  if (groups.length === 0) {
    return null;
  }

  return (
    <Stack gap="sm" mt="xl" style={{ textAlign: 'left' }}>
      <Title order={4}>Your Groups</Title>

      {currencyEntries.length > 0 && (
        <Paper p="sm" radius="md" bg="gray.0">
          {currencyEntries.map(([cur, total]) => (
            <MGroup key={cur} justify="space-between">
              <Text fw={600} c={total >= 0 ? 'green.8' : 'red.8'}>
                {currencyEntries.length > 1 ? `Balance (${cur}):` : 'Total Balance:'}
              </Text>
              <Text fw={700} size="lg" c={total >= 0 ? 'green.8' : 'red.8'}>
                {fmtAmt(total, cur)}
              </Text>
            </MGroup>
          ))}
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
                {fmtAmt(group.cachedBalance, group.cachedCurrency)}
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
