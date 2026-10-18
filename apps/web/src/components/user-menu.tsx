'use client';

import { Avatar, Button, DropdownMenu, useToast } from '@nibras/ui';
import { LogOut, Shield, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '../i18n/navigation';
import { logout } from '../lib/logout';

export interface UserMenuUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Display name, falling back to the email when the profile has no name yet. */
export function displayName(user: UserMenuUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

/** Logs out; on failure (network, API error) the user stays put and an error toast says so. */
export function useLogout(): { busy: boolean; run: () => Promise<void> } {
  const t = useTranslations('shell');
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await logout(router))) toast({ title: t('logoutFailed'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** *Se déconnecter* as a plain button (mobile "More" sheet). */
export function LogoutButton() {
  const t = useTranslations('shell');
  const { busy, run } = useLogout();
  return (
    <Button
      variant="ghost"
      className="justify-start text-danger"
      loading={busy}
      iconStart={<LogOut aria-hidden="true" className="size-4 rtl:-scale-x-100" />}
      onClick={() => void run()}
    >
      {t('logout')}
    </Button>
  );
}

/** Avatar menu (spec §5): name + email, *Mon profil*, *Sécurité*, *Se déconnecter*. */
export function UserMenu({ user }: { user: UserMenuUser }) {
  const t = useTranslations('shell');
  const router = useRouter();
  const { busy, run } = useLogout();
  const name = displayName(user);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('userMenu', { name })}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Avatar name={name} id={user.id} size="sm" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="w-64">
        <DropdownMenu.Label className="flex flex-col gap-0.5 py-2">
          <span className="truncate text-sm font-semibold text-fg">{name}</span>
          <span className="truncate font-normal" dir="ltr">
            {user.email}
          </span>
        </DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          icon={<UserRound />}
          onSelect={() => router.push('/app/settings/profile')}
        >
          {t('profile')}
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={<Shield />} onSelect={() => router.push('/app/settings/security')}>
          {t('security')}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          destructive
          icon={<LogOut className="rtl:-scale-x-100" />}
          disabled={busy}
          onSelect={() => void run()}
        >
          {t('logout')}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
