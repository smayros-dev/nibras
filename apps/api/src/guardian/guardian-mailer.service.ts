import { Inject, Injectable } from '@nestjs/common';
import { guardianPageLink } from '@nibras/contracts';
import type { GuardianLink, User, Workspace } from '@nibras/db';
import type {
  EmailMessage,
  EmailParamsByKey,
  EmailProvider,
  EmailTemplateKey,
} from '@nibras/providers';
import { PinoLogger } from 'nestjs-pino';
import { env } from '../config/env';
import { EMAIL_PROVIDER } from '../providers/providers.module';

/** A person the guardian emails name or reach. */
export type GuardianMailUser = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'locale'>;
export type GuardianMailWorkspace = Pick<Workspace, 'id' | 'name' | 'defaultLocale'>;

/** The parties of one (student, workspace) guardian link. */
export interface GuardianMailParties {
  link: Pick<GuardianLink, 'id' | 'workspaceId' | 'guardianEmail'>;
  workspace: GuardianMailWorkspace;
  student: GuardianMailUser;
  teacher: GuardianMailUser;
}

const fullName = (p: Pick<User, 'firstName' | 'lastName'>): string =>
  `${p.firstName} ${p.lastName}`.trim();

const origin = (): string => env.WEB_ORIGIN.replace(/\/+$/, '');

/**
 * Guardian decision emails, sent inline by the API after the commit (design D3: the
 * confirmation carries the guardian page secret, which must never transit through a job
 * payload). Every email names the student, the workspace and the teacher. The guardian (no
 * account) is written to in the workspace's default locale; the student and the staff in their
 * own. A delivery failure is logged with identifiers only (never a link) and swallowed: the
 * decision is committed.
 */
@Injectable()
export class GuardianMailerService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(GuardianMailerService.name);
  }

  /**
   * A grant (or re-grant): `guardian.consent_confirmation` to the guardian with the guardian page
   * link (`pageRaw`); when the membership was activated, `guardian.consent_granted` to the student
   * and `guardian.consent_granted_teacher` to the teacher.
   */
  async sendGranted(p: GuardianMailParties, pageRaw: string, activated: boolean): Promise<void> {
    const { workspace, student, teacher } = p;
    const common = {
      studentName: fullName(student),
      workspaceName: workspace.name,
      teacherName: fullName(teacher),
    };
    await this.send(
      p,
      p.link.guardianEmail,
      'guardian.consent_confirmation',
      workspace.defaultLocale,
      {
        ...common,
        link: guardianPageLink(env.WEB_ORIGIN, workspace.defaultLocale, pageRaw),
      },
    );
    if (!activated) return;
    await this.send(p, student.email, 'guardian.consent_granted', student.locale, {
      ...common,
      firstName: student.firstName,
      link: `${origin()}/${student.locale}/app/w/${workspace.id}`,
    });
    await this.send(p, teacher.email, 'guardian.consent_granted_teacher', teacher.locale, {
      ...common,
      firstName: teacher.firstName,
      link: `${origin()}/${teacher.locale}/app/w/${workspace.id}/students`,
    });
  }

  /**
   * `guardian.consent_refused` / `guardian.consent_revoked` to the student (`recipientRole:
   * 'STUDENT'`, link to his home page) and to each staff recipient (`'TEACHER'`, link to the
   * workspace's students page).
   */
  async sendDecision(
    templateKey: 'guardian.consent_refused' | 'guardian.consent_revoked',
    p: GuardianMailParties,
    staff: GuardianMailUser[],
  ): Promise<void> {
    const { workspace, student, teacher } = p;
    const common = {
      studentName: fullName(student),
      workspaceName: workspace.name,
      teacherName: fullName(teacher),
    };
    await this.send(p, student.email, templateKey, student.locale, {
      ...common,
      firstName: student.firstName,
      recipientRole: 'STUDENT',
      link: `${origin()}/${student.locale}/app`,
    });
    for (const member of staff) {
      await this.send(p, member.email, templateKey, member.locale, {
        ...common,
        firstName: member.firstName,
        recipientRole: 'TEACHER',
        link: `${origin()}/${member.locale}/app/w/${workspace.id}/students`,
      });
    }
  }

  private async send<K extends EmailTemplateKey>(
    p: GuardianMailParties,
    to: string,
    templateKey: K,
    locale: GuardianMailUser['locale'],
    params: EmailParamsByKey[K],
  ): Promise<void> {
    try {
      await this.email.send({ to, templateKey, locale, params } as EmailMessage<K>);
    } catch (err) {
      this.logger.error(
        {
          guardianLinkId: p.link.id,
          workspaceId: p.link.workspaceId,
          templateKey,
          err: { type: err instanceof Error ? err.name : typeof err },
        },
        'guardian email not sent',
      );
    }
  }
}
