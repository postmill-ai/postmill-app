import { BadRequestException } from '@nestjs/common';

export type DesignerDocOpErrorCode =
  | 'DESIGNER_OP_MODE_MISMATCH'
  | 'DESIGNER_OP_INDEX_OOB';

export class DesignerDocOpError extends BadRequestException {
  code: DesignerDocOpErrorCode;
  op: string;

  constructor(
    code: DesignerDocOpErrorCode,
    op: string,
    message: string,
  ) {
    super({ code, op, message });
    this.code = code;
    this.op = op;
  }
}
