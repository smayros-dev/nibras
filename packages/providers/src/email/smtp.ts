import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { renderEmail } from './templates';
import type { EmailMessage, EmailProvider, EmailTemplateKey } from './types';

export interface SmtpEmailProviderOptions {
  /** e.g. `smtp://localhost:1025` (Mailpit) or `smtps://user:pass@host:465`. */
  smtpUrl: string;
  /** RFC 5322 sender, e.g. `TT <no-reply@example.com>`. */
  from: string;
}

/** Hosts reached without TLS in development (Mailpit). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'mailpit']);

/**
 * nodemailer SMTP options from a connection URL: implicit TLS for `smtps:`, STARTTLS required
 * for `smtp:` on any non-local host, credentials URL-decoded, and explicit timeouts (connect and
 * greeting 10 s, socket inactivity 30 s) so a stuck server fails the job instead of hanging it.
 */
export function smtpTransportOptions(smtpUrl: string): SMTPTransport.Options {
  const url = new URL(smtpUrl);
  if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:')
    throw new Error(`SMTP_URL must use smtp: or smtps:, got ${url.protocol}`);
  const secure = url.protocol === 'smtps:';
  return {
    host: url.hostname,
    ...(url.port && { port: Number(url.port) }),
    secure,
    requireTLS: !secure && !LOCAL_HOSTS.has(url.hostname),
    ...(url.username && {
      auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) },
    }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

/** Sends rendered templates over SMTP (nodemailer): html + plain-text parts, optional ICS invite. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: Transporter;

  constructor(private readonly opts: SmtpEmailProviderOptions) {
    this.transport = createTransport(smtpTransportOptions(opts.smtpUrl));
  }

  async send<K extends EmailTemplateKey>(
    msg: EmailMessage<K>,
  ): Promise<{ providerMessageId: string }> {
    const { subject, html, text } = renderEmail(msg.templateKey, msg.locale, msg.params);
    const info = await this.transport.sendMail({
      from: this.opts.from,
      to: msg.to,
      subject,
      html,
      text,
      ...(msg.ics !== undefined && {
        icalEvent: { filename: 'invite.ics', method: 'REQUEST', content: msg.ics },
      }),
    });
    return { providerMessageId: info.messageId };
  }
}
