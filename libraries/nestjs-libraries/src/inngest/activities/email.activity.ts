import { Injectable } from '@nestjs/common';
import { EmailService } from '@postmill-ai/nestjs-libraries/services/email.service';
import { OrganizationService } from '@postmill-ai/nestjs-libraries/database/prisma/organizations/organization.service';

@Injectable()
export class EmailActivity {
  constructor(
    private _emailService: EmailService,
    private _organizationService: OrganizationService
  ) {}

  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    return this._emailService.sendEmailSync(to, subject, html, replyTo);
  }

  async sendEmailAsync(to: string, subject: string, html: string, sendTo: 'top' | 'bottom', replyTo?: string) {
    return await this._emailService.sendEmail(to, subject, html, sendTo, replyTo);
  }

  async getUserOrgs(id: string) {
    return this._organizationService.getTeam(id);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationService.setStreak(organizationId, type);
  }
}
