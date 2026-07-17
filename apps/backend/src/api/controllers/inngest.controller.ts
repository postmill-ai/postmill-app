import {
  All,
  Controller,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createInngestServeHandler } from '@gitroom/backend/inngest/serve';
import { InngestService } from '@gitroom/nestjs-libraries/inngest/inngest.service';

@Controller('/api/inngest')
export class InngestController {
  private readonly handler: ReturnType<typeof createInngestServeHandler>;

  constructor(private readonly inngestService: InngestService) {
    this.handler = createInngestServeHandler(inngestService.getFunctions());
  }

  @All()
  handle(@Req() req: Request, @Res() res: Response) {
    return this.handler(req, res);
  }
}
