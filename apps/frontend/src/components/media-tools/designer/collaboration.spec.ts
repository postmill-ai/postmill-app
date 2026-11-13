import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { createDesignerStore, type DesignerDoc, type VideoOutput } from './designer.store';
import {
  applyRemoteDoc,
  createCollaborationSubscription,
  deepClone,
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

  it('preserves active static geometry while reconciling a remote document on release', () => {
    const store = createDesignerStore();
    const shape = (id: string, x: number) => ({
      id,
      type: 'shape' as const,
      shape: 'rect' as const,
      x,
      y: 20,
      width: 100,
      height: 80,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
    });
    store.getState().addElement(shape('moving', 10));
    store.getState().addElement(shape('remote-edit', 300));
    const before = store.getState().doc;
    store.getState().setSelectedIds(['moving']);
    store.getState().beginGesture();
    store.getState().updateElementsEphemeral([{ id: 'moving', updates: { x: 65 } }]);
    const remote = deepClone(before);
    remote.outputs[0].children[1].x = 350;
    remote.outputs[0].name = 'Remote output name';

    applyRemoteDoc(store, remote);
    expect(store.getState().doc.outputs[0].children[0].x).toBe(65);
    expect(store.getState().doc.outputs[0].children[1].x).toBe(350);
    expect(store.getState().doc.outputs[0].name).toBe('Remote output name');
    expect(before.outputs[0].children[0].x).toBe(10);

    store.getState().commitElementGesture([{ id: 'moving', updates: { x: 65 } }]);
    store.getState().endGesture();
    expect(store.getState().doc.outputs[0].children[0].x).toBe(65);
    expect(store.getState().doc.outputs[0].children[1].x).toBe(350);
    store.getState().undo();
    expect(store.getState().doc.outputs[0].children[0].x).toBe(10);
  });

  it('holds selected clip geometry and keyframes without discarding other remote clip edits', () => {
    const store = createDesignerStore();
    store.getState().loadDesign(makeVideoDoc(), 'video-hold', 'Video hold');
    const before = store.getState().doc;
    store.getState().setSelectedClips([{ trackId: 'track-1', clipId: 'clip-a' }]);
    store.getState().beginGesture();
    store.getState().updateClipSilent(0, 'track-1', 'clip-a', {
      x: 75,
      keyframes: [{ tMs: 0, props: { x: 75 }, ease: 'linear' }],
    });
    const remote = deepClone(before);
    (remote.outputs[0] as VideoOutput).tracks[0].clips[1].opacity = 0.25;

    applyRemoteDoc(store, remote);
    const clips = (store.getState().doc.outputs[0] as VideoOutput).tracks[0].clips;
    expect(clips[0].x).toBe(75);
    expect(clips[0].keyframes?.[0].props.x).toBe(75);
    expect(clips[1].opacity).toBe(0.25);
    store.getState().pushHistory('Edit clip geometry');
    store.getState().endGesture();
    expect(store.getState().gestureDepth).toBe(0);
  });

  it('suppresses broadcasts during a gesture and sends the latest document once on release', () => {
    const store = createDesignerStore();
    const sendUpdate = vi.fn();
    const unsubscribe = createCollaborationSubscription(store, sendUpdate);
    expect(sendUpdate).toHaveBeenCalledTimes(1);

    store.getState().beginGesture();
    const remote = deepClone(store.getState().doc);
    remote.outputs[0].name = 'Changed during hold';
    applyRemoteDoc(store, remote);
    expect(sendUpdate).toHaveBeenCalledTimes(1);

    store.getState().endGesture();
    expect(sendUpdate).toHaveBeenCalledTimes(2);
    expect(sendUpdate.mock.calls[1][0]).toBe(store.getState().doc);
    unsubscribe();
  });

  it('carries and clears video gradient fills and text outlines', () => {
    const ydoc = new Y.Doc();
    const doc = makeVideoDoc();
    const clip = (doc.outputs[0] as VideoOutput).tracks[0].clips[0];
    clip.fillGradient = {
      type: 'linear',
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    };
    clip.textStroke = { color: '#123456', width: 3 };
    const last: { current: DesignerDoc | null } = { current: null };
    sendUpdate(ydoc, doc, last);

    let rebuiltClip = (rebuildDocFromY(ydoc.getMap(Y_DOC))!.outputs[0] as VideoOutput).tracks[0].clips[0];
    expect(rebuiltClip.fillGradient).toEqual(clip.fillGradient);
    expect(rebuiltClip.textStroke).toEqual(clip.textStroke);

    clip.fillGradient = undefined;
    clip.textStroke = undefined;
    sendUpdate(ydoc, doc, last);
    rebuiltClip = (rebuildDocFromY(ydoc.getMap(Y_DOC))!.outputs[0] as VideoOutput).tracks[0].clips[0];
    expect(rebuiltClip.fillGradient).toBeUndefined();
    expect(rebuiltClip.textStroke).toBeUndefined();
  });

  it('synchronizes frozen output flags in both directions', () => {
    const source = new Y.Doc();
    const peer = new Y.Doc();
    const doc = makeVideoDoc();
    (doc.outputs[0] as VideoOutput).frozen = true;
    const last: { current: DesignerDoc | null } = { current: null };

    Y.applyUpdate(peer, sendUpdate(source, doc, last));
    expect((rebuildDocFromY(peer.getMap(Y_DOC))!.outputs[0] as VideoOutput).frozen).toBe(true);

    (doc.outputs[0] as VideoOutput).frozen = undefined;
    Y.applyUpdate(peer, sendUpdate(source, doc, last));
    const rebuilt = rebuildDocFromY(peer.getMap(Y_DOC))!;
    expect((rebuilt.outputs[0] as VideoOutput).frozen).toBeUndefined();
    expect(peer.getMap(Y_DOC).get('outputs')?.toArray()[0].has('frozen')).toBe(false);
  });

  it('applies remote documents through the trusted replacement path', () => {
    const store = createDesignerStore();
    store.getState().setMode('video');
    store.getState().setOutputFrozen(0, true);
    const remote = makeVideoDoc();
    remote.outputs[0].name = 'Remote replacement';
    (remote.outputs[0] as VideoOutput).frozen = true;

    applyRemoteDesignerDoc(store, remote);

    expect(store.getState().doc.outputs[0].name).toBe('Remote replacement');
    expect(store.getState().doc.outputs[0].frozen).toBe(true);
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
