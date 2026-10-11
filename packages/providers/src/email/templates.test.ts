import { LOCALES } from '@tt/contracts';
import { describe, expect, it } from 'vitest';
import { extractFirstLink, renderEmail } from './templates';
import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from './types';

const SAMPLE_PARAMS: Record<EmailTemplateKey, Record<string, string | number>> = {
  'auth.verify_email': { firstName: 'Mohamed', link: 'https://x/fr/verify-email?token=t' },
  'auth.password_reset': { firstName: 'Mohamed', link: 'https://x/fr/reset-password?token=t' },
  'auth.email_change_confirm': {
    firstName: 'Mohamed',
    newEmail: 'new@example.com',
    link: 'https://x/fr/confirm-email?token=t',
  },
  'security.password_changed': { firstName: 'Mohamed' },
  'security.email_changed': { firstName: 'Mohamed', newEmail: 'new@example.com' },
  'security.new_device': { firstName: 'Mohamed', device: 'Firefox / Windows', ip: '203.0.113.7' },
  'security.token_reuse': { firstName: 'Mohamed' },
  'security.account_locked': { firstName: 'Mohamed', minutes: 15 },
  'security.2fa_enabled': { firstName: 'Mohamed' },
  'security.2fa_disabled': { firstName: 'Mohamed' },
  'security.recovery_code_used': { firstName: 'Mohamed', remaining: 9 },
  'phone.otp_dev': { otpCode: '123456' },
  'workspace.ownership_transferred': { firstName: 'Mohamed', workspaceName: 'École Ibn Khaldoun' },
  'abuse.report_received': { firstName: 'Mohamed' },
  'abuse.new_report': { link: 'https://x/fr/admin/abuse-reports/r1' },
  'abuse.minor_safety_reminder': { link: 'https://x/fr/admin/abuse-reports/r1' },
  'admin.user_suspended': { firstName: 'Mohamed', reason: 'Non-respect du code de conduite' },
  'admin.user_unsuspended': { firstName: 'Mohamed' },
};

const ARABIC = /[؀-ۿ]/;
const RAW_KEY = /\b(?:emails|auth|security|phone|workspace|abuse|admin)\.[a-z0-9_]+/;

describe('renderEmail', () => {
  it('renders every template key in every locale with no missing ICU argument', () => {
    for (const key of EMAIL_TEMPLATE_KEYS)
      for (const locale of LOCALES) {
        const out = renderEmail(key, locale, SAMPLE_PARAMS[key]);
        expect(out.subject.length, `${locale}:${key}`).toBeGreaterThan(3);
        expect(out.html).toContain(`lang="${locale}"`);
        expect(out.text, `${locale}:${key}`).not.toMatch(/\{\w+\}/);
        expect(out.html, `${locale}:${key}`).not.toMatch(/\{\w+\}/);
      }
  });

  it('never leaks a raw message key', () => {
    for (const key of EMAIL_TEMPLATE_KEYS)
      for (const locale of LOCALES) {
        const out = renderEmail(key, locale, SAMPLE_PARAMS[key]);
        expect(out.subject, `${locale}:${key}`).not.toMatch(RAW_KEY);
        expect(out.text, `${locale}:${key}`).not.toMatch(RAW_KEY);
      }
  });

  it('Arabic emails are RTL with an Arabic subject', () => {
    const out = renderEmail('auth.verify_email', 'ar', {
      firstName: 'أحمد',
      link: 'https://x/verify?token=t',
    });
    expect(out.html).toContain('dir="rtl"');
    expect(out.subject).toMatch(/[؀-ۿ]/);
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const ar = renderEmail(key, 'ar', SAMPLE_PARAMS[key]);
      expect(ar.html, key).toContain('dir="rtl"');
      expect(ar.subject, key).toMatch(ARABIC);
    }
  });

  it('French and English emails are LTR', () => {
    for (const locale of ['fr', 'en'] as const)
      expect(
        renderEmail('auth.verify_email', locale, SAMPLE_PARAMS['auth.verify_email']).html,
      ).toContain('dir="ltr"');
  });

  it('verify_email French subject and link', () => {
    const out = renderEmail('auth.verify_email', 'fr', {
      firstName: 'Mohamed',
      link: 'https://x/fr/verify-email?token=abc',
    });
    expect(out.subject).toBe('Vérifiez votre email');
    expect(extractFirstLink(out.html, '/verify-email')).toBe('https://x/fr/verify-email?token=abc');
    expect(out.text).toContain('https://x/fr/verify-email?token=abc');
    expect(out.text).toContain('Mohamed');
  });

  it('carries the app name and the legal footer in html and text', () => {
    const fr = renderEmail('security.password_changed', 'fr', { firstName: 'Mohamed' });
    expect(fr.html).toContain('Plateforme cours');
    expect(fr.text).toContain('Plateforme cours');
    const ar = renderEmail('security.password_changed', 'ar', { firstName: 'أحمد' });
    expect(ar.html).toContain('منصة الدروس');
  });

  it('HTML-escapes params (no markup injection) and keeps them raw in the text part', () => {
    const out = renderEmail('security.new_device', 'en', {
      firstName: '<script>alert(1)</script>',
      device: '"><img src=x onerror=alert(1)>',
      ip: '203.0.113.7',
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img');
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out.text).toContain('<script>alert(1)</script>');
  });

  it('escapes ampersands in links and extractFirstLink decodes them', () => {
    const link = 'https://x/fr/reset-password?token=a&locale=fr';
    const out = renderEmail('auth.password_reset', 'fr', { firstName: 'M', link });
    expect(out.html).toContain('token=a&amp;locale=fr');
    expect(extractFirstLink(out.html, '/reset-password')).toBe(link);
  });

  it('refuses a non-http(s) link', () => {
    expect(() =>
      renderEmail('auth.verify_email', 'fr', { firstName: 'M', link: 'javascript:alert(1)' }),
    ).toThrow(/link/);
  });

  it('throws on a missing ICU argument instead of sending a broken email', () => {
    expect(() => renderEmail('auth.verify_email', 'fr', { link: 'https://x/v' })).toThrow();
  });

  it('pluralises counts per locale', () => {
    expect(
      renderEmail('security.recovery_code_used', 'fr', { firstName: 'M', remaining: 1 }).text,
    ).toContain('1 code de récupération');
    expect(
      renderEmail('security.recovery_code_used', 'en', { firstName: 'M', remaining: 9 }).text,
    ).toContain('9 recovery codes');
  });

  it('puts the one-time code of phone.otp_dev in the body', () => {
    const out = renderEmail('phone.otp_dev', 'fr', { otpCode: '987654' });
    expect(out.text).toContain('987654');
    expect(out.html).toContain('987654');
  });
});

describe('extractFirstLink', () => {
  it('returns the first href containing the path, or null', () => {
    const html = '<a href="https://x/a">a</a><a href="https://x/b?t=1&amp;u=2">b</a>';
    expect(extractFirstLink(html, '/b')).toBe('https://x/b?t=1&u=2');
    expect(extractFirstLink(html, '/a')).toBe('https://x/a');
    expect(extractFirstLink(html, '/c')).toBeNull();
  });
});
