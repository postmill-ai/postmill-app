import { serve } from 'inngest/express';
import { inngest } from '@postmill-ai/nestjs-libraries/inngest/inngest.client';

export const createInngestServeHandler = (functions: any[]) =>
  serve({ client: inngest, functions });
