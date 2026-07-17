import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { AuthorizationActions, Sections, SubscriptionException } from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@Catch(SubscriptionException)
export class SubscriptionExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const error: { section: Sections; action: AuthorizationActions } =
      exception.getResponse() as any;

    const message = getErrorMessage(error);

    // Unified error envelope: { statusCode, error, message, ...context }.
    // `url` (the billing upsell link) is preserved as an extra context field.
    response.status(status).json({
      statusCode: status,
      error: 'Payment Required',
      message,
      url: process.env.FRONTEND_URL + '/billing',
    });
  }
}

const getErrorMessage = (error: {
  section: Sections;
  action: AuthorizationActions;
}) => {
  switch (error.section) {
    case Sections.POSTS_PER_MONTH:
      return 'You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts.';
    case Sections.CHANNEL:
      return 'You have reached the maximum number of channels for your subscription. Please upgrade your subscription to add more channels.';
    case Sections.WEBHOOKS:
      return 'You have reached the maximum number of webhooks for your subscription. Please upgrade your subscription to add more webhooks.';
    case Sections.TEAM_MEMBERS:
      return 'Your plan does not support additional team members. Please upgrade your subscription to invite more people.';
    case Sections.BRANDS:
      return 'Your plan does not support brand kits. Please upgrade your subscription to create brand kits.';
    case Sections.CAMPAIGNS:
      return 'Campaigns are not included in your plan. Please upgrade your subscription to use campaigns.';
    case Sections.API:
      return 'The developer API is not included in your plan. Please upgrade your subscription to enable API access.';
    case Sections.MCP:
      return 'AI-assistant access is not included in your plan. Please upgrade your subscription to use the AI assistant.';
    case Sections.COMPETITORS:
      return 'You have reached the maximum number of competitor tracking accounts for your subscription. Please upgrade your subscription to track more accounts.';
    case Sections.VIDEO_EXPORTS:
      return 'You have reached the maximum number of video exports for this billing cycle. Buy an add-on or upgrade your subscription to export more videos.';
    case Sections.STORAGE:
      return 'You have reached the hosted storage limit for your subscription. Buy a storage add-on, or upgrade your plan.';
    case Sections.BYO_STORAGE:
      return 'Connecting your own storage provider is not included in your plan. Please upgrade your subscription to use external storage.';
  }
};
