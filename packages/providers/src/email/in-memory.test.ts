import { describe, expect, it } from 'vitest';
import { InMemoryEmailProvider } from './in-memory';

describe('InMemoryEmailProvider', () => {
  it('records rendered emails and finds them by recipient and template', async () => {
    const provider = new InMemoryEmailProvider();
    const a = await provider.send({
      to: 'a@example.com',
      templateKey: 'auth.verify_email',
      locale: 'fr',
      params: { firstName: 'A', link: 'https://x/fr/verify-email?token=1' },
    });
    await provider.send({
      to: 'b@example.com',
      templateKey: 'security.password_changed',
      locale: 'en',
      params: { firstName: 'B' },
      ics: 'BEGIN:VCALENDAR',
    });

    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[0]).toMatchObject({
      to: 'a@example.com',
      templateKey: 'auth.verify_email',
      locale: 'fr',
      providerMessageId: a.providerMessageId,
      subject: 'Vérifiez votre email',
    });
    expect(provider.sent[0]!.html).toContain('https://x/fr/verify-email?token=1');
    expect(provider.last()?.to).toBe('b@example.com');
    expect(provider.last()?.ics).toBe('BEGIN:VCALENDAR');
    expect(provider.last('a@example.com')?.templateKey).toBe('auth.verify_email');
    expect(provider.last('nobody@example.com')).toBeUndefined();
    expect(provider.findByTemplate('security.password_changed')).toHaveLength(1);
    expect(provider.findByTemplate('security.password_changed', 'a@example.com')).toHaveLength(0);

    provider.clear();
    expect(provider.sent).toHaveLength(0);
    expect(provider.last()).toBeUndefined();
  });

  it('fails like the real provider when a template argument is missing', async () => {
    const provider = new InMemoryEmailProvider();
    await expect(
      provider.send({
        to: 'a@example.com',
        templateKey: 'auth.verify_email',
        locale: 'fr',
        // @ts-expect-error firstName and link are required
        params: {},
      }),
    ).rejects.toThrow();
    expect(provider.sent).toHaveLength(0);
  });

  it('failFor makes sends to that address reject (nothing recorded) until clear()', async () => {
    const provider = new InMemoryEmailProvider();
    const msg = (to: string) =>
      provider.send({
        to,
        templateKey: 'security.password_changed',
        locale: 'fr',
        params: { firstName: 'A' },
      });
    provider.failFor('down@example.com');
    await expect(msg('down@example.com')).rejects.toThrow(/down@example.com/);
    await msg('up@example.com');
    expect(provider.sent.map((m) => m.to)).toEqual(['up@example.com']);

    provider.clear();
    await msg('down@example.com');
    expect(provider.sent.map((m) => m.to)).toEqual(['down@example.com']);
  });
});
