import { useState } from 'react';
import {
  Paper, Title, TextInput, Button, Stack, Pill, Group as MGroup, Select, Tabs, Text, Alert,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import * as api from '../api';
import type { Group } from '../api';
import { createImportInput, type GroupExport } from '../exportImport';

interface CreateGroupProps {
  onGroupCreated: (group: Group, token: string) => void;
  onCancel: () => void;
}

export function CreateGroup({ onGroupCreated, onCancel }: CreateGroupProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [currency, setCurrency] = useState('EUR');
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>('create');

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

    const response = await api.createGroup(name, members, currency);
    onGroupCreated(response.group, response.token);
  };

  const handleImportJSON = () => {
    const input = createImportInput(async (data: GroupExport) => {
      try {
        setImportError(null);
        setImportLoading(true);

        const importedNames = data.members.map(m => m.name);
        if (importedNames.length < 2) {
          setImportError('Imported group must have at least 2 members');
          setImportLoading(false);
          return;
        }

        // Create the group with just names (backend assigns new IDs)
        const response = await api.createGroup(data.name, importedNames, data.currency);
        const { group: newGroup, token } = response;

        // Build a mapping from old member ID → new member ID, matched by name
        const idMap = new Map<string, string>();
        for (const oldMember of data.members) {
          const match = newGroup.members.find(m => m.name === oldMember.name);
          if (match) idMap.set(oldMember.id, match.id);
        }

        // Recreate expenses in chronological order, translating member IDs
        const sortedExpenses = [...data.expenses].sort(
          (a, b) => new Date(a.expense_date || a.created_at || '').getTime()
                  - new Date(b.expense_date || b.created_at || '').getTime()
        );

        for (const e of sortedExpenses) {
          const paidBy = idMap.get(e.paid_by);
          if (!paidBy) continue; // skip if payer not found (shouldn't happen)

          const splitBetween = e.split_between
            .map(id => idMap.get(id))
            .filter((id): id is string => id !== undefined);

          const transferTo = e.transfer_to ? idMap.get(e.transfer_to) ?? undefined : undefined;

          const splits = e.splits
            ?.map(s => ({ member_id: idMap.get(s.member_id) ?? '', share: s.share }))
            .filter(s => s.member_id !== '');

          await api.createExpense(
            token,
            e.description,
            e.amount,
            paidBy,
            splitBetween,
            e.expense_type,
            transferTo,
            e.expense_date,
            e.currency,
            e.exchange_rate,
            e.split_type,
            splits,
          );
        }

        onGroupCreated(newGroup, token);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      } finally {
        setImportLoading(false);
      }
    });
    input.click();
  };

  return (
    <Paper shadow="xs" p="xl" mt="lg" radius="md" withBorder>
      <Title order={3} mb="md">{t('createNewGroup')}</Title>
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="create">{t('createNewGroup')}</Tabs.Tab>
          <Tabs.Tab value="import">{t('importGroup')}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="create" pt="md">
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <TextInput
                label={t('groupName')}
                placeholder={t('groupNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <Select
                label={t('currency')}
                data={[
                  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK',
                  'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK',
                  'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN',
                  'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
                ]}
                value={currency}
                onChange={(val) => val && setCurrency(val)}
                searchable
              />

              <div>
                <TextInput
                  label={t('membersLabel')}
                  placeholder={t('enterMemberName')}
                  value={memberInput}
                  onChange={(e) => setMemberInput(e.target.value)}
                  onKeyDown={handleKeyPress}
                  rightSection={
                    <Button size="compact-xs" variant="light" onClick={handleAddMember}>
                      {t('add')}
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
                <Button variant="default" onClick={onCancel}>{t('cancel')}</Button>
                <Button type="submit" disabled={!name || members.length < 2}>
                  {t('createGroup')}
                </Button>
              </MGroup>
            </Stack>
          </form>
        </Tabs.Panel>

        <Tabs.Panel value="import" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t('importGroupDesc')}
            </Text>
            {importError && (
              <Alert color="red">
                {t('importError')}: {importError}
              </Alert>
            )}
            <Button fullWidth onClick={handleImportJSON} loading={importLoading}>
              {t('importFile')}
            </Button>
            <MGroup gap="sm">
              <Button variant="default" style={{ flex: 1 }} onClick={onCancel}>{t('cancel')}</Button>
            </MGroup>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Paper>
  );
}
