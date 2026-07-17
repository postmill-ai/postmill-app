import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DesignerDocLenientSchema,
  DesignerDocStrictSchema,
  DesignerDoc,
  DesignerElement,
  DesignerOutput,
  VideoOutput,
  VideoTrack,
  VideoClip,
} from './designer-doc.schema';
import { migrateDoc } from './designer-doc.migrate';
import {
  DesignerDocOpSchema,
  DesignerDocOpsSchema,
  IMAGE_ONLY_OPS,
  DesignerDocOp,
} from './designer-doc-ops.schema';
import { DesignerDocOpError } from './designer-doc.errors';
import { MAX_OPS_PER_REQUEST } from './designer-doc.limits';
import { seedCopy } from './seed-copy';
import { applyLinked } from './apply-linked';

const isImageOutput = (
  out: DesignerOutput | VideoOutput
): out is DesignerOutput => 'children' in out;

const isVideoOutput = (
  out: DesignerOutput | VideoOutput
): out is VideoOutput => 'tracks' in out;

@Injectable()
export class DesignerDocService {
  validate(raw: unknown): DesignerDoc {
    const migrated = migrateDoc(raw);
    const result = DesignerDocLenientSchema.safeParse(migrated);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid DesignerDoc',
        issues: result.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    return result.data as DesignerDoc;
  }

  validateStrict(raw: unknown): DesignerDoc {
    const migrated = migrateDoc(raw);
    const result = DesignerDocStrictSchema.safeParse(migrated);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Invalid DesignerDoc',
        issues: result.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    return result.data as DesignerDoc;
  }

  applyOps(doc: DesignerDoc, ops: DesignerDocOp[]): DesignerDoc {
    if (ops.length > MAX_OPS_PER_REQUEST) {
      throw new BadRequestException({
        message: `Too many ops: ${ops.length} > ${MAX_OPS_PER_REQUEST}`,
      });
    }

    // Strict-parse every op first — bad agent values fail fast with a path.
    const parsedOpsResult = DesignerDocOpsSchema.safeParse(ops);
    if (!parsedOpsResult.success) {
      throw new BadRequestException({
        message: 'Invalid DesignerDoc op',
        issues: parsedOpsResult.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    }
    const parsedOps = parsedOpsResult.data as any[];

    let current = structuredClone(doc) as DesignerDoc;

    for (const op of parsedOps) {
      if (IMAGE_ONLY_OPS.has(op.op)) {
        // Some image-only ops (e.g. addOutput) do not address an existing
        // output; the only pre-check is that the document itself is in image
        // mode. Ops that carry outputIndex validate the target exists and is
        // an image output.
        if ('outputIndex' in op) {
          const out = current.outputs[op.outputIndex];
          if (!out) {
            throw new DesignerDocOpError(
              'DESIGNER_OP_INDEX_OOB',
              op.op,
              `outputIndex ${op.outputIndex} out of range`
            );
          }
          if (!isImageOutput(out)) {
            throw new DesignerDocOpError(
              'DESIGNER_OP_MODE_MISMATCH',
              op.op,
              `op ${op.op} targets a video output`
            );
          }
        } else if (current.mode !== 'image') {
          throw new DesignerDocOpError(
            'DESIGNER_OP_MODE_MISMATCH',
            op.op,
            `op ${op.op} requires image mode`
          );
        }
      }

      current = this._applyOp(current, op);
    }

    current = this.assignIdsAndNormalize(current);

    // Final structural/bounds safety net — lenient so passthrough keys on a
    // legacy/template base survive.
    return this.validate(current);
  }

  private _applyOp(doc: DesignerDoc, op: DesignerDocOp): DesignerDoc {
    switch (op.op) {
      case 'setDoc':
        return migrateDoc(op.doc);

      case 'removeOutput': {
        const outputs = doc.outputs.filter((_, i) => i !== op.outputIndex);
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'addOutput': {
        // Use the primary (first) image output as the seed source so a
        // headless Composer's `setDoc`+`addOutput` sequence matches the manual
        // Designer's linked-by-default behavior. `seed: false` opts out
        // (empty white canvas, no originId backfill); a doc left without
        // outputs (removeOutput'd) has nothing to seed from.
        const primary = doc.outputs[0];
        const source =
          op.seed !== false && primary && isImageOutput(primary)
            ? primary
            : undefined;

        const newOutput: DesignerOutput = {
          id: '', // assigned by assignIdsAndNormalize
          formatId: op.preset.formatId,
          name: op.preset.name,
          width: op.preset.width,
          height: op.preset.height,
          background: source?.background ?? '#ffffff',
          bg: source?.bg,
          children: [],
        };

        if (source) {
          const sourceChildren = source.children.map((el) =>
            el.originId
              ? el
              : { ...el, originId: `origin-${randomUUID()}` }
          );
          newOutput.children = sourceChildren.map((el) =>
            seedCopy(el, source, newOutput, el.originId as string)
          );
          const outputs = doc.outputs.map((out, i) =>
            i === 0 ? { ...out, children: sourceChildren } : out
          ) as DesignerDoc['outputs'];
          outputs.push(newOutput);
          return { ...doc, outputs } as DesignerDoc;
        }

        return { ...doc, outputs: [...doc.outputs, newOutput] } as DesignerDoc;
      }

      case 'resizeOutput': {
        const outputs = doc.outputs.map((out, i) => {
          if (i !== op.outputIndex || !isImageOutput(out)) return out;
          const updated: DesignerOutput = {
            ...out,
            width: op.width,
            height: op.height,
          };
          if (op.formatId !== undefined) updated.formatId = op.formatId;
          if (op.name !== undefined) updated.name = op.name;
          return updated;
        });
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'setOutputBackground': {
        const outputs = doc.outputs.map((out, i) => {
          if (i !== op.outputIndex || !isImageOutput(out)) return out;
          return { ...out, bg: op.background };
        });
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'addElement': {
        const element = op.element as DesignerElement;
        const outputs = doc.outputs.map((out, i) => {
          if (i !== op.outputIndex || !isImageOutput(out)) return out;
          const children = [...out.children];
          if (op.beforeElementId) {
            const idx = children.findIndex((c) => c.id === op.beforeElementId);
            if (idx !== -1) {
              children.splice(idx, 0, element);
            } else {
              children.push(element);
            }
          } else {
            children.push(element);
          }
          return { ...out, children };
        });
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'updateElement': {
        // Target existence/mode already validated by the IMAGE_ONLY_OPS
        // pre-check in applyOps (updateElement always carries outputIndex).
        const isShared = op.scope === 'shared';
        const { outputs } = applyLinked(
          doc,
          op.outputIndex,
          new Set([op.elementId]),
          op.patch as Partial<DesignerElement>,
          !isShared
        );
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'removeElement': {
        const outputs = doc.outputs.map((out, i) => {
          if (i !== op.outputIndex || !isImageOutput(out)) return out;
          const children = out.children.filter((el) => el.id !== op.elementId);
          return { ...out, children };
        });
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'reorderElement': {
        const outputs = doc.outputs.map((out, i) => {
          if (i !== op.outputIndex || !isImageOutput(out)) return out;
          const children = [...out.children];
          const idx = children.findIndex((el) => el.id === op.elementId);
          if (idx === -1) return out;
          const [el] = children.splice(idx, 1);
          let newIdx: number;
          switch (op.dir) {
            case 'front':
              newIdx = children.length;
              break;
            case 'back':
              newIdx = 0;
              break;
            case 'forward':
              newIdx = Math.min(idx + 1, children.length);
              break;
            case 'backward':
              newIdx = Math.max(idx - 1, 0);
              break;
          }
          children.splice(newIdx, 0, el);
          return { ...out, children };
        });
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'placeImage': {
        const out = doc.outputs[op.outputIndex];
        if (!out || !isImageOutput(out)) return doc;

        const box = op.box;
        let x = 0;
        let y = 0;
        let width = Math.round(out.width * 0.8);
        let height = Math.round(out.height * 0.8);
        if (box) {
          x = box.x ?? x;
          y = box.y ?? y;
          width = box.width ?? width;
          height = box.height ?? height;
        } else {
          x = Math.round((out.width - width) / 2);
          y = Math.round((out.height - height) / 2);
        }

        const element: DesignerElement = {
          id: '',
          type: 'image',
          x,
          y,
          width,
          height,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          src: op.src,
          fileId: op.fileId,
        };

        const outputs = doc.outputs.map((o, i) => {
          if (i !== op.outputIndex || !isImageOutput(o)) return o;
          return { ...o, children: [...o.children, element] };
        });
        return { ...doc, outputs } as DesignerDoc;
      }

      default:
        // Exhaustiveness guard; every op is handled above.
        return doc;
    }
  }

  assignIdsAndNormalize(doc: DesignerDoc): DesignerDoc {
    const outputs = doc.outputs.map((out) => {
      if (isImageOutput(out)) {
        const children = out.children.map((el) => this._normalizeId(el, 'el'));
        return { ...out, id: out.id || `out-${randomUUID()}`, children };
      }
      if (isVideoOutput(out)) {
        const tracks = out.tracks.map((track) => {
          const clips = track.clips.map((clip) =>
            this._normalizeId(clip, 'clip')
          );
          return {
            ...track,
            id: track.id || `trk-${randomUUID()}`,
            clips,
          };
        });
        return { ...out, id: out.id || `out-${randomUUID()}`, tracks };
      }
      return out;
    });
    return { ...doc, outputs };
  }

  private _normalizeId<T extends { id?: string; originId?: string }>(
    item: T,
    prefix: string
  ): T {
    const id = item.id || `${prefix}-${randomUUID()}`;
    return { ...item, id, originId: item.originId ?? id };
  }

  buildPlaceImageOp(input: {
    outputIndex: number;
    src: string;
    fileId?: string;
    box?: Partial<{ x: number; y: number; width: number; height: number }>;
  }): DesignerDocOp {
    return {
      op: 'placeImage',
      outputIndex: input.outputIndex,
      src: input.src,
      fileId: input.fileId,
      box: input.box,
    };
  }
}
