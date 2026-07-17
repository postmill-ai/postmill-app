import { HttpException, HttpStatus } from '@nestjs/common';

export enum Sections {
  CHANNEL = 'channel',
  POSTS_PER_MONTH = 'posts_per_month',
  TEAM_MEMBERS = 'team_members',
  BRANDS = 'brands',
  CAMPAIGNS = 'campaigns',
  API = 'api',
  MCP = 'mcp',
  COMPETITORS = 'competitors',
  ADMIN = 'admin',
  WEBHOOKS = 'webhooks',
  MEDIA = 'media',
  VIDEO_EXPORTS = 'video_exports',
  STORAGE = 'storage',
  BYO_STORAGE = 'byo_storage',
}

export enum AuthorizationActions {
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
}

export class SubscriptionException extends HttpException {
  constructor(message: { section: Sections; action: AuthorizationActions }) {
    super(message, HttpStatus.PAYMENT_REQUIRED);
  }
}
