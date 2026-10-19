import { LOCALES } from '@nibras/contracts';
import { describe, expect, it } from 'vitest';
import { extractFirstLink, renderEmail } from './templates';
import { EMAIL_TEMPLATE_KEYS, type EmailParamsByKey } from './types';

const SAMPLE_PARAMS: EmailParamsByKey = {
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
  'invitation.received_student': {
    hasName: 'yes',
    firstName: 'Yasmine',
    inviterName: 'Mohamed Ben Ali',
    workspaceName: 'École Ibn Khaldoun',
    hasMessage: 'yes',
    message: 'Bienvenue dans la classe de terminale !',
    link: 'https://x/fr/invite/t',
    expiresAt: '26 octobre 2026',
  },
  'invitation.received_staff': {
    inviterName: 'Mohamed Ben Ali',
    workspaceName: 'École Ibn Khaldoun',
    role: 'TEACHER',
    link: 'https://x/fr/invite/t',
    expiresAt: '26 octobre 2026',
  },
  'invitation.accepted': {
    firstName: 'Mohamed',
    memberName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    link: 'https://x/fr/app/w/w1/students',
  },
  'guardian.consent_requested': {
    studentName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    link: 'https://x/fr/guardian-consent/t',
    expiresAt: '2 novembre 2026',
  },
  'guardian.consent_confirmation': {
    studentName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    link: 'https://x/fr/guardian/t',
  },
  'guardian.consent_granted': {
    firstName: 'Yasmine',
    studentName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    link: 'https://x/fr/app/w/w1',
  },
  'guardian.consent_granted_teacher': {
    firstName: 'Mohamed',
    studentName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    link: 'https://x/fr/app/w/w1/students/u1',
  },
  'guardian.consent_refused': {
    firstName: 'Yasmine',
    studentName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    recipientRole: 'STUDENT',
    link: 'https://x/fr/app/w/w1',
  },
  'guardian.consent_revoked': {
    firstName: 'Mohamed',
    studentName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    recipientRole: 'TEACHER',
    link: 'https://x/fr/app/w/w1/students/u1',
  },
  'guardian.consent_expired': {
    firstName: 'Yasmine',
    studentName: 'Yasmine Trabelsi',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    recipientRole: 'STUDENT',
    link: 'https://x/fr/app/w/w1',
  },
  'join.approved': {
    firstName: 'Yasmine',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    link: 'https://x/fr/app/w/w1',
  },
  'join.rejected': {
    firstName: 'Yasmine',
    workspaceName: 'École Ibn Khaldoun',
    teacherName: 'Mohamed Ben Ali',
    link: 'https://x/fr/app',
  },
  'imports.completed': {
    firstName: 'Mohamed',
    workspaceName: 'École Ibn Khaldoun',
    created: 95,
    failed: 2,
    link: 'https://x/fr/app/w/w1/students?tab=pending',
  },
};

/** The 13 SP2 templates (invitations, guardian consent, join requests, CSV imports). */
const SP2_KEYS = EMAIL_TEMPLATE_KEYS.filter((k) =>
  /^(?:invitation|guardian|join|imports)\./.test(k),
);

/**
 * The teacher a template names: `teacherName` / `inviterName`, or the recipient's own first name
 * when the email goes to the teacher (`invitation.accepted`, `imports.completed`).
 */
function teacherOf(params: Record<string, unknown>): string {
  return String(params.teacherName ?? params.inviterName ?? params.firstName);
}

const ARABIC = /[؀-ۿ]/;
const RAW_KEY =
  /\b(?:emails|auth|security|phone|workspace|abuse|admin|invitation|guardian|join|imports)\.[a-z0-9_]+/;

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
    expect(out.html).toMatch(/<div dir="rtl" lang="ar"/);
    expect(out.subject).toMatch(/[؀-ۿ]/);
    // Interpolated values are bidi-isolated: <bdi> in html, FSI…PDI in the text part.
    expect(out.html).toContain('<bdi>أحمد</bdi>');
    expect(out.text).toContain('⁨أحمد⁩');
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const ar = renderEmail(key, 'ar', SAMPLE_PARAMS[key]);
      expect(ar.html, key).toContain('dir="rtl"');
      expect(ar.subject, key).toMatch(ARABIC);
    }
  });

  it('isolates Latin values inside Arabic text and escapes inside <bdi>', () => {
    const out = renderEmail('security.new_device', 'ar', {
      firstName: '<b>Ali</b>',
      device: 'Firefox / Windows',
      ip: '203.0.113.7',
    });
    expect(out.html).toContain('<bdi>&lt;b&gt;Ali&lt;/b&gt;</bdi>');
    expect(out.html).toContain('<bdi>Firefox / Windows</bdi>');
    expect(out.text).toContain('⁨Firefox / Windows⁩');
    expect(out.text).toContain('⁨203.0.113.7⁩');
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
    expect(fr.html).toContain('Nibras');
    expect(fr.text).toContain('Nibras');
    const ar = renderEmail('security.password_changed', 'ar', { firstName: 'أحمد' });
    expect(ar.html).toContain('نبراس');
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
    // @ts-expect-error firstName is required by the template's params type
    expect(() => renderEmail('auth.verify_email', 'fr', { link: 'https://x/v' })).toThrow();
  });

  it('pluralises counts per locale with a grammatical zero branch', () => {
    const text = (locale: 'fr' | 'en' | 'ar', remaining: number) =>
      renderEmail('security.recovery_code_used', locale, { firstName: 'M', remaining }).text;
    expect(text('fr', 0)).toContain('Vous n’avez plus aucun code de récupération.');
    expect(text('fr', 1)).toContain('Il vous reste 1 code de récupération.');
    expect(text('fr', 9)).toContain('Il vous reste 9 codes de récupération.');
    expect(text('en', 0)).toContain('You have no recovery codes left.');
    expect(text('en', 1)).toContain('You have 1 recovery code left.');
    expect(text('en', 9)).toContain('You have 9 recovery codes left.');
    expect(text('ar', 0)).toContain('لم يتبقَّ لديك أي رمز استرداد.');
    expect(text('ar', 2)).toContain('تبقّى لديك رمزا استرداد.');
  });

  it('puts the one-time code of phone.otp_dev in the body', () => {
    const out = renderEmail('phone.otp_dev', 'fr', { otpCode: '987654' });
    expect(out.text).toContain('987654');
    expect(out.html).toContain('987654');
  });
});

describe('SP2 templates', () => {
  it('adds 13 templates', () => {
    expect(SP2_KEYS).toHaveLength(13);
  });

  it('every SP2 template names the workspace and the teacher in every locale', () => {
    for (const key of SP2_KEYS)
      for (const locale of LOCALES) {
        const params = SAMPLE_PARAMS[key] as Record<string, unknown>;
        const out = renderEmail(key, locale, SAMPLE_PARAMS[key]);
        expect(out.text, `${locale}:${key}`).toContain(params.workspaceName);
        expect(out.text, `${locale}:${key}`).toContain(teacherOf(params));
        expect(out.html, `${locale}:${key}`).toContain(`<bdi>${teacherOf(params)}</bdi>`);
      }
  });

  it('guardian.consent_requested in ar is RTL with an Arabic subject and the link as CTA', () => {
    const out = renderEmail('guardian.consent_requested', 'ar', {
      studentName: 'أحمد',
      workspaceName: 'فضاء محمد',
      teacherName: 'محمد',
      link: 'https://x/ar/guardian-consent/t',
      expiresAt: '١ نوفمبر',
    });
    expect(out.html).toContain('dir="rtl"');
    expect(out.subject).toMatch(/[؀-ۿ]/);
    expect(extractFirstLink(out.html, '/guardian-consent/')).toBe(
      'https://x/ar/guardian-consent/t',
    );
  });

  it('guardian.consent_requested French subject quotes the PRD and carries the expiry', () => {
    const out = renderEmail(
      'guardian.consent_requested',
      'fr',
      SAMPLE_PARAMS['guardian.consent_requested'],
    );
    expect(out.subject).toBe('Yasmine Trabelsi souhaite rejoindre l’espace de Mohamed Ben Ali');
    expect(out.text).toContain('2 novembre 2026');
  });

  it('guardian.consent_confirmation warns that the link must not be forwarded', () => {
    const p = SAMPLE_PARAMS['guardian.consent_confirmation'];
    expect(renderEmail('guardian.consent_confirmation', 'fr', p).text).toContain(
      'ne le transférez',
    );
    expect(renderEmail('guardian.consent_confirmation', 'en', p).text).toContain('do not forward');
    expect(renderEmail('guardian.consent_confirmation', 'ar', p).text).toContain('لا تُعِد توجيه');
  });

  it('greets by first name or neutrally, and shows the personal message only when present', () => {
    const base = SAMPLE_PARAMS['invitation.received_student'];
    for (const locale of LOCALES) {
      const named = renderEmail('invitation.received_student', locale, base).text;
      expect(named, locale).toContain('Yasmine');
      expect(named, locale).toContain(base.message);
      expect(named, locale).toContain(base.expiresAt);
    }
    const fr = renderEmail('invitation.received_student', 'fr', {
      ...base,
      hasName: 'no',
      firstName: '',
      hasMessage: 'no',
      message: '',
    });
    expect(fr.text).toContain('Bonjour,');
    expect(fr.text).not.toContain('« »');
    expect(fr.html).not.toContain('<bdi></bdi>');
    expect(fr.html).not.toMatch(/<p[^>]*><\/p>/);
  });

  it('keeps select arguments raw (roles and recipients pick their sentence in every locale)', () => {
    const staff = (locale: 'fr' | 'ar' | 'en', role: 'TEACHER' | 'ADMIN') =>
      renderEmail('invitation.received_staff', locale, {
        ...SAMPLE_PARAMS['invitation.received_staff'],
        role,
      }).text;
    expect(staff('fr', 'TEACHER')).toContain('professeur');
    expect(staff('fr', 'ADMIN')).toContain('administrateur');
    expect(staff('en', 'TEACHER')).toContain('teacher');
    expect(staff('en', 'ADMIN')).toContain('administrator');
    expect(staff('ar', 'TEACHER')).toContain('أستاذ');
    expect(staff('ar', 'ADMIN')).toContain('مسؤول');

    for (const key of [
      'guardian.consent_refused',
      'guardian.consent_revoked',
      'guardian.consent_expired',
    ] as const)
      for (const locale of LOCALES) {
        const p = SAMPLE_PARAMS[key];
        const student = renderEmail(key, locale, { ...p, recipientRole: 'STUDENT' }).text;
        const teacher = renderEmail(key, locale, { ...p, recipientRole: 'TEACHER' }).text;
        expect(student, `${locale}:${key}`).not.toBe(teacher);
      }
  });

  it('pluralises import counts per locale', () => {
    const text = (locale: 'fr' | 'en' | 'ar', created: number, failed: number) =>
      renderEmail('imports.completed', locale, {
        ...SAMPLE_PARAMS['imports.completed'],
        created,
        failed,
      }).text;
    expect(text('fr', 1, 0)).toContain('1 invitation a été envoyée.');
    expect(text('fr', 95, 2)).toContain('95 invitations ont été envoyées.');
    expect(text('fr', 95, 0)).toContain('Aucun envoi n’a échoué.');
    expect(text('fr', 95, 1)).toContain('1 envoi a échoué');
    expect(text('fr', 95, 2)).toContain('2 envois ont échoué');
    expect(text('en', 1, 0)).toContain('1 invitation was sent.');
    expect(text('en', 95, 2)).toContain('95 invitations were sent.');
    expect(text('en', 95, 0)).toContain('No email failed.');
    expect(text('en', 95, 1)).toContain('1 email failed');
    expect(text('ar', 2, 0)).toContain('أُرسلت دعوتان.');
    expect(text('ar', 95, 0)).toContain('لم يفشل أي إرسال.');
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
