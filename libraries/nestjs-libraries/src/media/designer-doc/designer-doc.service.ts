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
  appendPage,
  duplicatePageAt,
  movePage,
  removePageAt,
} from './designer-doc.pages';
import {
  DesignerDocOpSchema,
  DesignerDocOpsSchema,
  IMAGE_ONLY_OPS,
  DesignerDocOp,
} from './designer-doc-ops.schema';
import { DesignerDocOpError } from './designer-doc.errors';
import { MAX_OPS_PER_REQUEST } from './designer-doc.limits';
import { seedCopy } from './seed-copy';
import {
  seedVideoOutput,
  reflowVideoOutputInPlace,
} from './video-reflow';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import {
  computeContainerBoxes,
  computeGroupBoxes,
  computeTextStackBoxes,
  reflowBackground,
} from './reflow';
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
      // Surface the zod paths in the message itself — callers (conductor logs,
      // agent retries) typically only see `err.message`, and a bare "Invalid
      // DesignerDoc op" is undebuggable.
      const detail = parsedOpsResult.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new BadRequestException({
        message: `Invalid DesignerDoc op — ${detail}`,
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

      case 'addPage':
      case 'removePage':
      case 'duplicatePage':
      case 'reorderPage': {
        // Target existence/mode was validated by the IMAGE_ONLY_OPS pre-check.
        const outputs = doc.outputs.map((out, i) => {
          if (i !== op.outputIndex || !isImageOutput(out)) return out;
          let next: DesignerOutput | null;
          switch (op.op) {
            case 'addPage':
              next = appendPage(out, {
                id: '', // assigned by assignIdsAndNormalize
                name: op.name,
                background: op.background,
                children: [],
              });
              break;
            case 'removePage':
              next = removePageAt(out, op.pageNumber);
              break;
            case 'duplicatePage':
              next = duplicatePageAt(out, op.pageNumber, `pg-${randomUUID()}`);
              break;
            case 'reorderPage':
              next = movePage(out, op.from, op.to);
              break;
          }
          if (!next) {
            throw new DesignerDocOpError(
              'DESIGNER_OP_INDEX_OOB',
              op.op,
              `op ${op.op} cannot be applied to output ${op.outputIndex} (bad page range or page cap reached)`
            );
          }
          return next;
        });
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'addOutput': {
        // Video documents get a video variant: the primary output's tracks and
        // clips clone with fresh ids (originId shared, backfilled on the
        // primary) and smart-reflow onto the new canvas; timing/fps/durationMs
        // copy unchanged. `seed: false` opts out (empty timeline).
        if (doc.mode === 'video') {
          const primary = doc.outputs[0];
          const source =
            op.seed !== false && primary && isVideoOutput(primary)
              ? primary
              : undefined;
          if (!source) {
            const preset = CHANNEL_PRESETS.find((p) => p.id === op.preset.formatId);
            const newVideoOutput: VideoOutput = {
              id: '', // assigned by assignIdsAndNormalize
              formatId: op.preset.formatId,
              name: op.preset.name,
              width: op.preset.width,
              height: op.preset.height,
              fps: preset?.fps ?? 30,
              durationMs: preset?.maxDurationMs ?? 10000,
              tracks: [],
            };
            return { ...doc, outputs: [...doc.outputs, newVideoOutput] } as DesignerDoc;
          }
          const { output, sourceTracks } = seedVideoOutput(
            source,
            op.preset,
            () => randomUUID()
          );
          // The output id follows the `out-…` convention — let the normalize
          // pass mint it (track/clip ids are already fresh from the seed).
          output.id = '';
          const outputs = doc.outputs.map((out, i) =>
            i === 0 && isVideoOutput(out) ? { ...out, tracks: sourceTracks } : out
          ) as DesignerDoc['outputs'];
          outputs.push(output);
          return { ...doc, outputs } as DesignerDoc;
        }

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
          // The copy stack's vertical budget belongs to the DESIGN, not to one
          // canvas — carried over so this format's type is measured with the
          // same rule the primary was composed under (see `typeBasisPx`).
          typeBudget: source?.typeBudget,
          children: [],
        };
        // An image background is cover-cropped like an image element, so its
        // focal point is only valid for the aspect it was computed against —
        // re-derive it for this canvas when the centroid rode along.
        newOutput.bg = reflowBackground(newOutput.bg, newOutput);

        if (source) {
          const sourceChildren = source.children.map((el) =>
            el.originId
              ? el
              : { ...el, originId: `origin-${randomUUID()}` }
          );
          // Copy stacks (headline/subhead columns, plus any grouped CTA that
          // sits in the same column rhythm) seed through one synthetic shared
          // frame so the thirds-bucketing can't split them apart — stack
          // membership WINS, because a group inside a stack must follow the
          // stack (its own members still share that one frame, so the pair
          // stays glued). A group outside any stack falls back to its own
          // combined bbox.
          const groupBoxes = computeGroupBoxes(sourceChildren);
          const stackBoxes = computeTextStackBoxes(sourceChildren, source);
          // Elements inside a layout panel (split-panel / editorial-sidebar)
          // reflow horizontally against the PANEL — which scales per-axis —
          // instead of the canvas, whose uniform ratio shrank the copy away
          // from the panel's margins and left a dead gutter.
          const containerBoxes = computeContainerBoxes(sourceChildren);
          newOutput.children = sourceChildren.map((el) =>
            seedCopy(
              el,
              source,
              newOutput,
              el.originId as string,
              stackBoxes.get(el) ??
                (el.groupId ? groupBoxes.get(el.groupId) : undefined),
              containerBoxes.get(el)
            )
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
        const target = doc.outputs[op.outputIndex];
        if (!target) {
          throw new DesignerDocOpError(
            'DESIGNER_OP_INDEX_OOB',
            op.op,
            `outputIndex ${op.outputIndex} out of range`
          );
        }
        // Video outputs reflow their clips in place (ids preserved, timing
        // untouched) — the same video-reflow the store's resize applies.
        if (isVideoOutput(target)) {
          const outputs = doc.outputs.map((out, i) =>
            i === op.outputIndex && isVideoOutput(out)
              ? reflowVideoOutputInPlace(out, op.width, op.height, op.formatId, op.name)
              : out
          );
          return { ...doc, outputs } as DesignerDoc;
        }
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
        // Video-capable: VideoOutput carries `bg` (the frame renderer paints
        // it under the tracks), so the op applies to both output kinds. No
        // IMAGE_ONLY_OPS pre-check runs for this op — validate the target here.
        const target = doc.outputs[op.outputIndex];
        if (!target) {
          throw new DesignerDocOpError(
            'DESIGNER_OP_INDEX_OOB',
            op.op,
            `outputIndex ${op.outputIndex} out of range`
          );
        }
        const outputs = doc.outputs.map((out, i) =>
          i === op.outputIndex ? { ...out, bg: op.background } : out
        );
        return { ...doc, outputs } as DesignerDoc;
      }

      case 'updateClip':
      case 'replaceClipMedia':
      case 'updateTransition': {
        const { output, track, clip } = this._resolveVideoClip(doc, op);

        if (op.op === 'updateClip') {
          const startMs = op.patch.startMs ?? clip.startMs;
          const endMs = op.patch.endMs ?? clip.endMs;
          // Same duration-cap rule the editor store enforces: timing may not
          // cross the output duration or invert. REJECTED, not clamped — the
          // model must see the failure rather than ship a silent clamp.
          // Overlaps with sibling clips on the same track are NOT rejected:
          // visual tracks legitimately stack (imageDocToVideoDoc layers
          // full-duration clips on one track), so overlap is normal.
          if (endMs <= startMs) {
            throw new DesignerDocOpError(
              'DESIGNER_OP_CLIP_TIMING',
              op.op,
              `clip ${clip.id}: endMs ${endMs} must be after startMs ${startMs}`
            );
          }
          if (endMs > output.durationMs || startMs >= output.durationMs) {
            throw new DesignerDocOpError(
              'DESIGNER_OP_CLIP_TIMING',
              op.op,
              `clip ${clip.id}: [${startMs}, ${endMs}) exceeds the output duration ${output.durationMs}ms`
            );
          }
          return this._patchVideoClip(doc, op.outputIndex, track.id, clip.id, {
            ...op.patch,
            startMs,
            endMs,
          });
        }

        if (op.op === 'replaceClipMedia') {
          // Only media-carrying clips have pixels to swap; a text/shape/audio
          // clip has no `src` semantics.
          if (
            track.type !== 'video' &&
            track.type !== 'image' &&
            track.type !== 'sticker' &&
            track.type !== 'raster'
          ) {
            throw new DesignerDocOpError(
              'DESIGNER_OP_MODE_MISMATCH',
              op.op,
              `clip ${clip.id} sits on a ${track.type} track — no media to replace`
            );
          }
          // The source geometry describes the MEDIA, so it travels with the
          // swap (same contract as the image-element swap in the conductor's
          // _replaceSlotImagery).
          const patch: Partial<VideoClip> = { src: op.src };
          if (op.fileId !== undefined) patch.fileId = op.fileId;
          if (op.focalPoint !== undefined) patch.focalPoint = op.focalPoint;
          if (op.naturalWidth !== undefined) patch.naturalWidth = op.naturalWidth;
          if (op.naturalHeight !== undefined) patch.naturalHeight = op.naturalHeight;
          return this._patchVideoClip(doc, op.outputIndex, track.id, clip.id, patch);
        }

        // updateTransition — the transition's overlap can never outlast the
        // clip itself, so durationMs clamps to the clip's own duration (the
        // frame renderer clamps the same way at draw time).
        const clipDuration = clip.endMs - clip.startMs;
        const transition = op.transition
          ? {
              ...op.transition,
              durationMs: Math.min(op.transition.durationMs, clipDuration),
            }
          : undefined;
        return op.edge === 'in'
          ? this._patchVideoClip(doc, op.outputIndex, track.id, clip.id, {
              transitionIn: transition,
            })
          : this._patchVideoClip(doc, op.outputIndex, track.id, clip.id, {
              transitionOut: transition,
            });
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

  /**
   * Resolve the clip a clip-op addresses. `trackId` (optional) narrows the
   * search; without it the FIRST clip with the id wins (clip ids are
   * normalized unique per output, so collisions only occur on hand-built
   * docs). Throws on a missing/non-video target.
   */
  private _resolveVideoClip(
    doc: DesignerDoc,
    op: { op: string; outputIndex: number; trackId?: string; clipId: string }
  ): { output: VideoOutput; track: VideoTrack; clip: VideoClip } {
    const out = doc.outputs[op.outputIndex];
    if (!out) {
      throw new DesignerDocOpError(
        'DESIGNER_OP_INDEX_OOB',
        op.op,
        `outputIndex ${op.outputIndex} out of range`
      );
    }
    if (!isVideoOutput(out)) {
      throw new DesignerDocOpError(
        'DESIGNER_OP_MODE_MISMATCH',
        op.op,
        `op ${op.op} targets an image output`
      );
    }
    const tracks = op.trackId
      ? out.tracks.filter((t) => t.id === op.trackId)
      : out.tracks;
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === op.clipId);
      if (clip) return { output: out, track, clip };
    }
    throw new DesignerDocOpError(
      'DESIGNER_OP_CLIP_NOT_FOUND',
      op.op,
      `clip ${op.clipId} not found on output ${op.outputIndex}`
    );
  }

  /**
   * Apply a clip patch FORMAT-LOCALLY — only the addressed output changes.
   * Clips link variants by `originId` and the interactive editor propagates
   * content/style across them (`applyLinkedVideoClip`), but headless revise
   * ops make no cross-output propagation in v1 (see designer-doc-ops.schema).
   */
  private _patchVideoClip(
    doc: DesignerDoc,
    outputIndex: number,
    trackId: string,
    clipId: string,
    patch: Partial<VideoClip>
  ): DesignerDoc {
    const outputs = doc.outputs.map((out, i) => {
      if (i !== outputIndex || !isVideoOutput(out)) return out;
      return {
        ...out,
        tracks: out.tracks.map((track) =>
          track.id !== trackId
            ? track
            : {
                ...track,
                clips: track.clips.map((clip) =>
                  clip.id === clipId ? ({ ...clip, ...patch } as VideoClip) : clip
                ),
              }
        ),
      };
    });
    return { ...doc, outputs } as DesignerDoc;
  }

  /**
   * Remove every id/originId (outputs, children, pages, tracks, clips) so a
   * re-mint via `assignIdsAndNormalize` never collides with the source doc —
   * template instantiation and `.pdesign` import both funnel through it.
   */
  stripIds(doc: DesignerDoc): DesignerDoc {
    const outputs = doc.outputs.map((out: any) => {
      const base = { ...out };
      delete base.id;
      delete base.originId;
      if ('children' in base) {
        base.children = base.children.map((el: any) => {
          const e = { ...el };
          delete e.id;
          delete e.originId;
          return e;
        });
        // Pages (v8): strip page ids and their elements' ids the same way.
        if (Array.isArray(base.pages)) {
          base.pages = base.pages.map((page: any) => {
            const p = { ...page };
            delete p.id;
            p.children = (p.children || []).map((el: any) => {
              const e = { ...el };
              delete e.id;
              delete e.originId;
              return e;
            });
            return p;
          });
        }
      }
      if ('tracks' in base) {
        base.tracks = base.tracks.map((track: any) => {
          const t = { ...track };
          delete t.id;
          delete t.originId;
          t.clips = t.clips.map((clip: any) => {
            const c = { ...clip };
            delete c.id;
            delete c.originId;
            return c;
          });
          return t;
        });
      }
      return base;
    });
    return { ...doc, outputs } as DesignerDoc;
  }

  assignIdsAndNormalize(doc: DesignerDoc): DesignerDoc {
    const outputs = doc.outputs.map((out) => {
      if (isImageOutput(out)) {
        const children = out.children.map((el) => this._normalizeId(el, 'el'));
        // Page elements are normalized exactly like page-1 children; page ids
        // get their own prefix so a missing one never collides with elements.
        const pages = out.pages?.map((page) => ({
          ...page,
          id: page.id || `pg-${randomUUID()}`,
          children: page.children.map((el) => this._normalizeId(el, 'el')),
        }));
        return { ...out, id: out.id || `out-${randomUUID()}`, children, pages };
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
