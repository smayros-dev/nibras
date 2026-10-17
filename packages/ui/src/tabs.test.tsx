import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './tabs';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { renderWithDir } from './test/render';

function PanelTabs({ onValueChange }: { onValueChange?: (v: string) => void }) {
  return (
    <Tabs.Root defaultValue="profile" onValueChange={onValueChange}>
      <Tabs.List aria-label="Paramètres">
        <Tabs.Trigger value="profile">Profil</Tabs.Trigger>
        <Tabs.Trigger value="security">Sécurité</Tabs.Trigger>
        <Tabs.Trigger value="consents">Consentements</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="profile">Panneau profil</Tabs.Content>
      <Tabs.Content value="security">Panneau sécurité</Tabs.Content>
      <Tabs.Content value="consents">Panneau consentements</Tabs.Content>
    </Tabs.Root>
  );
}

describe('Tabs', () => {
  it('ArrowRight moves to the next tab in ltr', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithDir(<PanelTabs onValueChange={onValueChange} />, { dir: 'ltr' });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panneau profil');
    await user.click(screen.getByRole('tab', { name: 'Profil' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Sécurité' })).toHaveFocus();
    expect(onValueChange).toHaveBeenLastCalledWith('security');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panneau sécurité');
  });

  it('ArrowLeft moves to the next tab in rtl', async () => {
    const user = userEvent.setup();
    renderWithDir(<PanelTabs />, { dir: 'rtl' });
    await user.click(screen.getByRole('tab', { name: 'Profil' }));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Sécurité' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Sécurité' })).toHaveAttribute('aria-selected', 'true');
  });

  it('asLinks: triggers are real links, the active one is aria-current=page, focus does not select', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithDir(
      <Tabs.Root value="security" asLinks onValueChange={onValueChange}>
        <Tabs.List aria-label="Paramètres">
          <Tabs.Trigger value="profile" asChild>
            <a href="/fr/app/settings/profile">Profil</a>
          </Tabs.Trigger>
          <Tabs.Trigger value="security" asChild>
            <a href="/fr/app/settings/security">Sécurité</a>
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>,
    );
    const profile = screen.getByRole('tab', { name: 'Profil' });
    const security = screen.getByRole('tab', { name: 'Sécurité' });
    expect(profile.tagName).toBe('A');
    expect(profile).toHaveAttribute('href', '/fr/app/settings/profile');
    expect(security).toHaveAttribute('aria-current', 'page');
    expect(profile).not.toHaveAttribute('aria-current');
    // No panels in link mode: no dangling aria-controls, no type attribute on anchors.
    expect(profile).not.toHaveAttribute('aria-controls');
    expect(profile).not.toHaveAttribute('type');
    security.focus();
    await user.keyboard('{ArrowLeft}');
    expect(profile).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('the list scrolls horizontally instead of wrapping', () => {
    renderWithDir(<PanelTabs />);
    const list = screen.getByRole('tablist');
    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).toContain('scroll-ps-4');
    expect(list.className).not.toContain('flex-wrap');
  });

  it('uses only logical utilities', () => {
    const { container } = renderWithDir(<PanelTabs />, { dir: 'rtl' });
    expectNoPhysicalClasses(container);
  });
});
