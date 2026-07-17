import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { DesignerDoc, VideoOutput } from './designer.store';
import {
  deepEqual,
  rebuildDocFromY,
  syncVideoDocToY,
} from './collaboration';

const Y_DOC = 'doc';

function makeVideoDoc(): DesignerDoc {
  return {
    version: 2,
    mode: 'video',
    outputs: [
      {
        id: 'out-1',
        formatId: 'ig-reel',
        name: 'IG Reel',
        width: 1080,
        height: 1920,
        fps: 30,
        durationMs: 15000,
        tracks: [
          {
            id: 'track-1',
            type: 'video' as const,
            clips: [
              {
                id: 'clip-a',
                startMs: 0,
                endMs: 5000,
                x: 0,
                y: 0,
                opacity: 1,
              },
              {
                id: 'clip-b',
                startMs: 5000,
                endMs: 10000,
                x: 100,
                y: 100,
                opacity: 0.8,
              },
            ],
          },
        ],
      },
    ],
  };
}

function sendUpdate(
  ydoc: Y.Doc,
  doc: DesignerDoc,
  lastDocRef: { current: DesignerDoc | null }
): Uint8Array {
  const docMap = ydoc.getMap(Y_DOC);
  const lastDoc = lastDocRef.current;
  lastDocRef.current = JSON.parse(JSON.stringify(doc));
  ydoc.transact(() => {
    if (doc.mode === 'video') {
      syncVideoDocToY(docMap, doc, lastDoc);
    } else {
      docMap.set('mode', doc.mode);
      docMap.set('version', doc.version);
      docMap.set('attribution', null);
      docMap.set('data', JSON.stringify(doc));
      if (docMap.has('outputs')) docMap.delete('outputs');
    }
  }, 'local');
  return Y.encodeStateAsUpdate(ydoc);
}

describe('collaboration Yjs contract', () => {
  it('merges concurrent edits to different clips without clobbering', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const lastA: { current: DesignerDoc | null } = { current: null };
    const lastB: { current: DesignerDoc | null } = { current: null };

    // Both clients start from the same document.
    const baseDoc = makeVideoDoc();
    Y.applyUpdate(docB, sendUpdate(docA, baseDoc, lastA));

    // Client A changes clip-a opacity.
    const aDoc = makeVideoDoc();
    (aDoc.outputs[0] as VideoOutput).tracks[0].clips[0].opacity = 0.5;
    const updateA = sendUpdate(docA, aDoc, lastA);

    // Client B changes clip-b position.
    const bDoc = makeVideoDoc();
    (bDoc.outputs[0] as VideoOutput).tracks[0].clips[1].x = 999;
    const updateB = sendUpdate(docB, bDoc, lastB);

    // Cross-apply updates.
    Y.applyUpdate(docB, updateA);
    Y.applyUpdate(docA, updateB);

    const mergedA = rebuildDocFromY(docA.getMap(Y_DOC));
    const mergedB = rebuildDocFromY(docB.getMap(Y_DOC));

    expect(mergedA).toBeTruthy();
    expect(deepEqual(mergedA, mergedB)).toBe(true);
    const clips = (mergedA!.outputs[0] as VideoOutput).tracks[0].clips;
    expect(clips.find((c) => c.id === 'clip-a')?.opacity).toBe(0.5);
    expect(clips.find((c) => c.id === 'clip-b')?.x).toBe(999);
  });

  it('keeps image mode as whole-doc JSON string', () => {
    const ydoc = new Y.Doc();
    const docMap = ydoc.getMap(Y_DOC);
    const imageDoc: DesignerDoc = {
      version: 2,
      mode: 'image',
      outputs: [
        {
          id: 'out-1',
          formatId: 'ig-post',
          name: 'IG Post',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          children: [],
        },
      ],
    };

    const last: { current: DesignerDoc | null } = { current: null };
    sendUpdate(ydoc, imageDoc, last);

    expect(docMap.get('mode')).toBe('image');
    expect(typeof docMap.get('data')).toBe('string');
    expect(docMap.has('outputs')).toBe(false);
    expect(rebuildDocFromY(docMap)).toEqual(imageDoc);
  });

  it('reconstructs video keyframes as fine-grained shared types', () => {
    const ydoc = new Y.Doc();
    const doc = makeVideoDoc();
    (doc.outputs[0] as VideoOutput).tracks[0].clips[0].keyframes = [
      { tMs: 0, props: { x: 0, opacity: 1 }, ease: 'linear' },
      { tMs: 1000, props: { x: 100, opacity: 0.5 }, ease: 'easeInOut' },
    ];

    const last: { current: DesignerDoc | null } = { current: null };
    sendUpdate(ydoc, doc, last);

    const docMap = ydoc.getMap(Y_DOC);
    const yClip = docMap
      .get('outputs')
      ?.toArray()[0]
      ?.get('tracks')
      ?.toArray()[0]
      ?.get('clips')
      ?.toArray()[0];

    expect(yClip).toBeInstanceOf(Y.Map);
    const yKeyframes = yClip.get('keyframes') as Y.Array<Y.Map<any>>;
    expect(yKeyframes).toBeInstanceOf(Y.Array);
    expect(yKeyframes.length).toBe(2);
    expect(yKeyframes.get(0).get('tMs')).toBe(0);
    expect(yKeyframes.get(1).get('ease')).toBe('easeInOut');

    const rebuilt = rebuildDocFromY(docMap);
    const clip = (rebuilt!.outputs[0] as VideoOutput).tracks[0].clips[0];
    expect(clip.keyframes).toHaveLength(2);
    expect(clip.keyframes?.[1].props).toEqual({ x: 100, opacity: 0.5 });
  });

  it('does not notify when the rebuilt doc is unchanged', () => {
    const ydoc = new Y.Doc();
    const docMap = ydoc.getMap(Y_DOC);
    const onRemoteDoc = vi.fn();
    let lastRebuilt: DesignerDoc | null = null;

    ydoc.on('update', (_update, origin) => {
      if (origin === 'local') return;
      const rebuilt = rebuildDocFromY(docMap);
      if (!rebuilt) return;
      if (deepEqual(lastRebuilt, rebuilt)) return;
      lastRebuilt = JSON.parse(JSON.stringify(rebuilt));
      onRemoteDoc(rebuilt);
    });

    const doc = makeVideoDoc();
    const last: { current: DesignerDoc | null } = { current: null };
    Y.applyUpdate(ydoc, sendUpdate(new Y.Doc(), doc, last));
    expect(onRemoteDoc).toHaveBeenCalledTimes(1);

    // Applying the same state again should not trigger another notification.
    Y.applyUpdate(ydoc, sendUpdate(new Y.Doc(), doc, { current: null }));
    expect(onRemoteDoc).toHaveBeenCalledTimes(1);
  });
});
