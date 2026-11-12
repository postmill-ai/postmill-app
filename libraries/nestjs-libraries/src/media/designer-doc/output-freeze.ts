import type {
  DesignerDoc,
  DesignerOutput,
  VideoOutput,
} from './designer-doc.schema';

export type FreezableOutput = DesignerOutput | VideoOutput;

export const isOutputFrozen = (output: FreezableOutput | undefined): boolean =>
  output?.frozen === true;

const withoutFrozen = (output: FreezableOutput) => {
  const { frozen: _frozen, ...content } = output;
  return content;
};

/**
 * A frozen output may change only its own `frozen` flag. Matching by id also
 * rejects deleting or replacing a frozen output during a whole-document op.
 */
export const hasFrozenOutputMutation = (
  before: Pick<DesignerDoc, 'outputs'>,
  after: Pick<DesignerDoc, 'outputs'>
): boolean => {
  const afterById = new Map(after.outputs.map((output) => [output.id, output]));
  return before.outputs.some((output) => {
    if (!isOutputFrozen(output)) return false;
    const next = afterById.get(output.id);
    return (
      !next ||
      JSON.stringify(withoutFrozen(output)) !==
        JSON.stringify(withoutFrozen(next))
    );
  });
};

export const withOutputFrozen = <T extends FreezableOutput>(
  output: T,
  frozen: boolean
): T => ({ ...output, frozen: frozen ? true : undefined });
