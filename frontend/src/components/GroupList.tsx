import { Title, Text, Card, Stack, Group as MGroup, Badge, ActionIcon, Paper } from '@mantine/core';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const handleRemove = (e: React.MouseEvent, group: StoredGroup) => {
    e.stopPropagation();
    if (confirm(t('confirmRemoveGroup', { name: group.name }))) {
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
      <Title order={4}>{t('yourGroups')}</Title>

      {currencyEntries.length > 0 && (
        <Paper p="sm" radius="md" bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))">
          {currencyEntries.map(([cur, total]) => (
            <MGroup key={cur} justify="space-between">
              <Text fw={600} c={total >= 0 ? 'green' : 'red'}>
                {currencyEntries.length > 1 ? t('balanceCurrency', { currency: cur }) : t('totalBalance')}
              </Text>
              <Text fw={700} size="lg" c={total >= 0 ? 'green' : 'red'}>
                {fmtAmt(total, cur)}
              </Text>
            </MGroup>
          ))}
        </Paper>
      )}

      {groups.map(group => {
        const hasNewActivity = !!(
          group.latestActivityAt &&
          (!group.lastCheckedAt || group.latestActivityAt > group.lastCheckedAt)
        );
        return (
        <Card
          key={group.id}
          padding="sm"
          radius="md"
          withBorder
          onClick={() => onSelectGroup(group.token)}
          style={{ cursor: 'pointer', transition: 'transform 0.1s', position: 'relative', overflow: 'visible' }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateX(4px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')}
        >
          {hasNewActivity && (
            <div style={{
              position: 'absolute',
              top: -6,
              left: -6,
              background: 'var(--mantine-color-blue-6)',
              color: 'white',
              borderRadius: '999px',
              minWidth: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              padding: '0 5px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              zIndex: 1,
            }}>
              {group.newActivityCount || '!'}
            </div>
          )}
          <MGroup justify="space-between" wrap="nowrap">
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text fw={500} truncate>{group.name}</Text>
              <Text size="xs" c="dimmed">
                {group.selectedMemberName
                  ? t('you', { name: group.selectedMemberName })
                  : t('selectYourselfInGroup')}
              </Text>
            </div>
            {group.cachedBalance !== undefined && (
              <Badge
                size="lg"
                variant="filled"
                color={group.cachedBalance >= 0 ? 'green' : 'red'}
              >
                {fmtAmt(group.cachedBalance, group.cachedCurrency)}
              </Badge>
            )}
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={(e) => handleRemove(e, group)}
              title={t('removeFromList')}
            >
              ×
            </ActionIcon>
          </MGroup>
        </Card>
        );
      })}
    </Stack>
  );
};
