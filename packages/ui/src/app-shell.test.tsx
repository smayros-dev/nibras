import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './app-shell';

const nav = [
  { href: '/ar', label: 'لوحة التحكم', current: true },
  { href: '/ar/courses', label: 'الدروس' },
];

describe('AppShell', () => {
  it('renders the nav items as links, marks the current one and the children', () => {
    render(
      <AppShell
        locale="ar"
        dir="rtl"
        nav={nav}
        labels={{ skipToContent: 'تخطَّ إلى المحتوى', primaryNav: 'التنقل الرئيسي' }}
      >
        <h1>مرحباً</h1>
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'لوحة التحكم' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'الدروس' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('مرحباً');
  });

  it('exposes a named navigation landmark and a skip link to #main', () => {
    render(
      <AppShell
        locale="fr"
        dir="ltr"
        nav={[]}
        labels={{ skipToContent: 'Aller au contenu', primaryNav: 'Navigation principale' }}
      >
        x
      </AppShell>,
    );
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aller au contenu' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('uses no physical left/right utility classes (direction comes from <html dir>)', () => {
    const { container } = render(
      <AppShell
        locale="fr"
        dir="ltr"
        nav={nav}
        labels={{ skipToContent: 'Aller au contenu', primaryNav: 'Navigation principale' }}
      >
        <p>x</p>
      </AppShell>,
    );
    const classes = Array.from(container.querySelectorAll('[class]')).flatMap((el) =>
      el.getAttribute('class')!.split(/\s+/),
    );
    expect(
      classes.filter((c) =>
        /^-?(ml|mr|pl|pr|left|right|rounded-[lr]|border-[lr]|text-left|text-right)(-|$)/.test(c),
      ),
    ).toEqual([]);
  });
});
