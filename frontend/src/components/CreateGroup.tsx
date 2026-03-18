import { useState } from 'react';
import {
  Paper, Title, TextInput, Button, Stack, Pill, Group as MGroup, Select,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import * as api from '../api';
import type { Group } from '../api';

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

  return (
    <Paper shadow="xs" p="xl" mt="lg" radius="md" withBorder>
      <Title order={3} mb="md">{t('createNewGroup')}</Title>
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
    </Paper>
  );
}
