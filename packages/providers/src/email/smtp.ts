import { createTransport, type Transporter } from 'nodemailer';
import { renderEmail } from './templates';
import type { EmailMessage, EmailProvider } from './types';

export interface SmtpEmailProviderOptions {
  /** e.g. `smtp://localhost:1025` (Mailpit) or `smtps://user:pass@host:465`. */
  smtpUrl: string;
  /** RFC 5322 sender, e.g. `TT <no-reply@example.com>`. */
  from: string;
}

/** Sends rendered templates over SMTP (nodemailer): html + plain-text parts, optional ICS invite. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: Transporter;

  constructor(private readonly opts: SmtpEmailProviderOptions) {
    this.transport = createTransport(opts.smtpUrl);
  }

  async send(msg: EmailMessage): Promise<{ providerMessageId: string }> {
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
