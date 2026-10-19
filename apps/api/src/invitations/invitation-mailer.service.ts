import { Inject, Injectable } from '@nestjs/common';
import { intlTag, invitationLink, type Locale } from '@nibras/contracts';
import type { GuardedClient, Invitation, User, Workspace } from '@nibras/db';
import type { EmailProvider } from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { env } from '../config/env';
import { DB } from '../db/db.module';
import { EMAIL_PROVIDER } from '../providers/providers.module';

export type InvitationMailWorkspace = Pick<
  Workspace,
  'id' | 'name' | 'defaultLocale' | 'defaultTimezone'
>;
export type InvitationMailPerson = Pick<User, 'firstName' | 'lastName'>;

const fullName = (p: InvitationMailPerson): string => `${p.firstName} ${p.lastName}`.trim();

/**
 * A date as the recipient reads it: long date style, the recipient's locale (Western digits,
 * Gregorian calendar — same rules as `@nibras/i18n`'s `formatDate`), the workspace time zone.
 */
export function formatMailDate(date: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: 'long',
    timeZone,
    calendar: 'gregory',
  }).format(date);
}

/**
 * Invitation emails, sent inline by the API (design D3: the link carries a secret, which must
 * never transit through a job payload). A delivery failure is logged with identifiers only
 * (never the link) and swallowed: the invitation exists and « Renvoyer » sends it again.
 */
@Injectable()
export class InvitationMailerService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(DB) private readonly db: Pick<GuardedClient, 'user'>,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(InvitationMailerService.name);
  }

  /** The invitee's locale: his account's when one exists for the address, else the workspace's. */
  async recipientLocale(
    email: string,
    workspace: Pick<Workspace, 'defaultLocale'>,
  ): Promise<Locale> {
    const user = await this.db.user.findUnique({ where: { email }, select: { locale: true } });
    return user?.locale ?? workspace.defaultLocale;
  }

  /**
   * `invitation.received_student` (STUDENT) or `invitation.received_staff` (TEACHER / ADMIN) to
   * the invited address with the `/{locale}/invite/{raw}` link and the expiry date formatted in
   * the recipient's locale and the workspace time zone.
   */
  async sendInvitation(
    invitation: Pick<
      Invitation,
      'id' | 'email' | 'role' | 'firstName' | 'message' | 'expiresAt' | 'workspaceId'
    >,
    raw: string,
    inviter: InvitationMailPerson,
    workspace: InvitationMailWorkspace,
  ): Promise<void> {
    try {
      const locale = await this.recipientLocale(invitation.email, workspace);
      const link = invitationLink(env.WEB_ORIGIN, locale, raw);
      const expiresAt = formatMailDate(invitation.expiresAt, locale, workspace.defaultTimezone);
      const inviterName = fullName(inviter);
      if (invitation.role === 'TEACHER' || invitation.role === 'ADMIN') {
        await this.email.send({
          to: invitation.email,
          templateKey: 'invitation.received_staff',
          locale,
          params: {
            inviterName,
            workspaceName: workspace.name,
            role: invitation.role,
            link,
            expiresAt,
          },
        });
        return;
      }
      await this.email.send({
        to: invitation.email,
        templateKey: 'invitation.received_student',
        locale,
        params: {
          hasName: invitation.firstName ? 'yes' : 'no',
          firstName: invitation.firstName ?? '',
          inviterName,
          workspaceName: workspace.name,
          hasMessage: invitation.message ? 'yes' : 'no',
          message: invitation.message ?? '',
          link,
          expiresAt,
        },
      });
    } catch (err) {
      this.failed(invitation, err);
    }
  }

  /**
   * `invitation.accepted` to the inviter (interim stand-in for SP7's in-app notification, Q6),
   * in his locale, linking to the workspace's students page.
   */
  async sendAccepted(
    invitation: Pick<Invitation, 'id' | 'workspaceId'>,
    member: InvitationMailPerson,
    inviter: InvitationMailPerson & Pick<User, 'email' | 'locale'>,
    workspace: InvitationMailWorkspace,
  ): Promise<void> {
    try {
      const origin = env.WEB_ORIGIN.replace(/\/+$/, '');
      await this.email.send({
        to: inviter.email,
        templateKey: 'invitation.accepted',
        locale: inviter.locale,
        params: {
          firstName: inviter.firstName,
          memberName: fullName(member),
          workspaceName: workspace.name,
          link: `${origin}/${inviter.locale}/app/w/${workspace.id}/students`,
        },
      });
    } catch (err) {
      this.failed(invitation, err);
    }
  }

  private failed(invitation: Pick<Invitation, 'id' | 'workspaceId'>, err: unknown): void {
    this.logger.error(
      {
        invitationId: invitation.id,
        workspaceId: invitation.workspaceId,
        err: { type: err instanceof Error ? err.name : typeof err },
      },
      'invitation email not sent',
    );
  }
}
