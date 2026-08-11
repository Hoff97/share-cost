import { useEffect, useState } from 'react';
import { Paper, Stack, Text, Button, Select, Loader, Group as MGroup, Center } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import * as api from '../offlineApi';
import type { Group } from '../offlineApi';
import { getStoredGroups, setSelectedMember, type StoredGroup } from '../storage';
import { notifyFinchConnected } from '../finchHandoff';

interface ConnectableGroup {
  stored: StoredGroup;
  // undefined while its full group (for the member list) is still loading;
  // null if the fetch failed (token revoked, group deleted) - excluded from
  // the ready set either way, same as one still missing a picked identity.
  group: Group | null | undefined;
  selectedMemberId: string | null;
}

const READ_ONLY_PERMISSIONS = {
  can_delete_group: false,
  can_manage_members: false,
  can_update_payment: false,
  can_add_expenses: false,
  can_edit_expenses: false,
};

/** Rendered by App.tsx instead of the normal landing screen while a
 * finch:connect-request is pending (see finchHandoff.ts). Every group this
 * browser already knows about (getStoredGroups) is offered for connecting;
 * one still missing a resolved "who are you" identity is shown but not
 * connectable until picked, since Finch needs to know which member's
 * balance is "mine" and share-cost has no server-side concept of that. */
export function FinchConnect() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ConnectableGroup[] | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const stored = getStoredGroups();
    if (stored.length === 0) {
      setItems([]);
      return;
    }
    setItems(stored.map((sg) => ({ stored: sg, group: undefined, selectedMemberId: sg.selectedMemberId ?? null })));
    stored.forEach((sg) => {
      api.getGroup(sg.token, sg.id).then((group) => {
        setItems((prev) => prev?.map((it) => (it.stored.id === sg.id ? { ...it, group } : it)) ?? prev);
      });
    });
  }, []);

  const updateMember = (groupId: string, memberId: string, memberName: string) => {
    setSelectedMember(groupId, memberId, memberName);
    setItems((prev) => prev?.map((it) => (it.stored.id === groupId ? { ...it, selectedMemberId: memberId } : it)) ?? prev);
  };

  const readyItems = (items ?? []).filter((it) => it.group && it.selectedMemberId);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const payload = await Promise.all(
        readyItems.map(async (it) => {
          const share = await api.generateShareLink(it.stored.token, READ_ONLY_PERMISSIONS);
          const member = it.group!.members.find((m) => m.id === it.selectedMemberId)!;
          return {
            id: it.stored.id,
            name: it.stored.name,
            currency: it.group!.currency,
            memberId: member.id,
            memberName: member.name,
            shareCode: share.code,
          };
        }),
      );
      notifyFinchConnected(payload);
    } finally {
      setConnecting(false);
    }
  };

  if (items === null) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (items.length === 0) {
    return (
      <Paper p="xl" radius="md" withBorder mt="lg">
        <Text ta="center" c="dimmed">
          {t('finchConnectNoGroups')}
        </Text>
      </Paper>
    );
  }

  return (
    <Paper p="xl" radius="md" withBorder mt="lg">
      <Stack>
        <div>
          <Text fw={600}>{t('finchConnectTitle')}</Text>
          <Text size="sm" c="dimmed">
            {t('finchConnectDesc')}
          </Text>
        </div>
        {items.map((it) => (
          <MGroup key={it.stored.id} justify="space-between" wrap="nowrap">
            <div>
              <Text size="sm" fw={500}>
                {it.stored.name}
              </Text>
              <Text size="xs" c="dimmed">
                {it.group === null ? t('finchConnectUnavailable') : (it.group?.currency ?? '…')}
              </Text>
            </div>
            {it.group === undefined ? (
              <Loader size="xs" />
            ) : it.group === null ? null : (
              <Select
                placeholder={t('whoAreYou')}
                data={it.group.members.map((m) => ({ value: m.id, label: m.name }))}
                value={it.selectedMemberId}
                onChange={(val) => {
                  const member = it.group!.members.find((m) => m.id === val);
                  if (val && member) updateMember(it.stored.id, val, member.name);
                }}
                w={160}
              />
            )}
          </MGroup>
        ))}
        <Button onClick={handleConnect} loading={connecting} disabled={readyItems.length === 0}>
          {t('finchConnectButton', { count: readyItems.length })}
        </Button>
      </Stack>
    </Paper>
  );
}
