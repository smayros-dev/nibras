import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, avatarInitials, avatarTone } from './avatar';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Avatar', () => {
  it('derives initials from the first two words, upper-cased', () => {
    expect(avatarInitials('mohamed smaïri')).toBe('MS');
    expect(avatarInitials('  ali  ben salah ')).toBe('AB');
    expect(avatarInitials('Ines')).toBe('I');
    expect(avatarInitials('محمد السميري')).toBe('ما');
    expect(avatarInitials('')).toBe('');
  });

  it('picks a deterministic tone class from the id (never an inline style)', () => {
    expect(avatarTone('user-1')).toBe(avatarTone('user-1'));
    expect(avatarTone('user-1')).toMatch(/^bg-avatar-[0-7]$/);
    const tones = new Set(Array.from({ length: 64 }, (_, i) => avatarTone(`u${i}`)));
    expect(tones.size).toBeGreaterThan(4);
  });

  it('renders the initials fallback, named for assistive tech', () => {
    const { container } = render(<Avatar name="Mohamed Smaïri" id="u-1" size="lg" />);
    const img = screen.getByRole('img', { name: 'Mohamed Smaïri' });
    expect(img).toHaveTextContent('MS');
    expect(img.className).toContain(avatarTone('u-1'));
    expect(container.querySelector('[style]')).toBeNull();
    expectNoPhysicalClasses(container);
  });

  it('hashes the name when no id is given', () => {
    render(<Avatar name="Ines" />);
    expect(screen.getByRole('img', { name: 'Ines' }).className).toContain(avatarTone('Ines'));
  });
});
