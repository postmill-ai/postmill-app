import { serve } from 'inngest/express';
import { inngest } from '@gitroom/nestjs-libraries/inngest/inngest.client';

export const createInngestServeHandler = (functions: any[]) =>
  serve({ client: inngest, functions });
