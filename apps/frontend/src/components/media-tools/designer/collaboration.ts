import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type {
  DesignerAttribution,
  DesignerDoc,
  VideoClip,
  VideoOutput,
  VideoTrack,
} from './designer.store';

export interface TimelineAwareness {
  type: 'timeline';
  playheadMs: number;
  selectedClipId: string | null;
  clientId: string;
}

export interface ImageAwareness {
  type: 'image';
  clientId: string;
  outputIndex: number;
  mouseX: number;
  mouseY: number;
  selectedIds: string[];
}

interface UseCollaborationOptions {
  designId: string | null;
  enabled: boolean;
  onRemoteDoc: (doc: DesignerDoc) => void;
  onConnectedChange?: (count: number) => void;
  onPeerTimeline?: (awareness: TimelineAwareness[]) => void;
  onPeerImage?: (awareness: ImageAwareness[]) => void;
}

const Y_DOC = 'doc';
const Y_AWARENESS = 'awareness';
const Y_MODE = 'mode';
const Y_VERSION = 'version';
const Y_ATTRIBUTION = 'attribution';
const Y_DATA = 'data';
const Y_OUTPUTS = 'outputs';

let clientCounter = 0;

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setIfChanged(m: Y.Map<any>, key: string, value: any) {
  if (m.get(key) !== value) {
    m.set(key, value);
  }
}

function deleteIfPresent(m: Y.Map<any>, key: string) {
  if (m.has(key)) {
    m.delete(key);
  }
}

function syncArrayById<T extends { id: string }>(
  yArr: Y.Array<Y.Map<any>>,
  items: T[],
  create: (item: T) => Y.Map<any>,
  sync: (m: Y.Map<any>, item: T, lastItem?: T) => void,
  lastItems?: T[]
): void {
  const lastMap = new Map<string, T>();
  if (lastItems) {
    for (const item of lastItems) {
      lastMap.set(item.id, item);
    }
  }

  const current = yArr.toArray();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const existingAtIdx = current[i];
    if (existingAtIdx && existingAtIdx.get('id') === item.id) {
      sync(existingAtIdx, item, lastMap.get(item.id));
      continue;
    }

    const foundIndex = current.findIndex(
      (m, idx) => idx >= i && m.get('id') === item.id
    );
    if (foundIndex >= 0) {
      const m = current[foundIndex];
      yArr.delete(foundIndex);
      yArr.insert(i, [m]);
      current.splice(foundIndex, 1);
      current.splice(i, 0, m);
      sync(m, item, lastMap.get(item.id));
    } else {
      const m = create(item);
      yArr.insert(i, [m]);
      sync(m, item, lastMap.get(item.id));
      current.splice(i, 0, m);
    }
  }

  while (current.length > items.length) {
    yArr.delete(current.length - 1);
    current.pop();
  }
}

function createOutputMap(): Y.Map<any> {
  return new Y.Map<any>();
}

function syncOutputMap(
  m: Y.Map<any>,
  output: VideoOutput,
  lastOutput?: VideoOutput
): void {
  setIfChanged(m, 'id', output.id);
  setIfChanged(m, 'formatId', output.formatId);
  setIfChanged(m, 'name', output.name);
  setIfChanged(m, 'width', output.width);
  setIfChanged(m, 'height', output.height);
  setIfChanged(m, 'fps', output.fps);
  setIfChanged(m, 'durationMs', output.durationMs);

  let yTracks = m.get('tracks') as Y.Array<Y.Map<any>> | undefined;
  if (!yTracks) {
    yTracks = new Y.Array<Y.Map<any>>();
    m.set('tracks', yTracks);
  }
  syncArrayById(
    yTracks,
    output.tracks,
    createTrackMap,
    syncTrackMap,
    lastOutput?.tracks
  );
}

function createTrackMap(): Y.Map<any> {
  return new Y.Map<any>();
}

function syncTrackMap(
  m: Y.Map<any>,
  track: VideoTrack,
  lastTrack?: VideoTrack
): void {
  setIfChanged(m, 'id', track.id);
  setIfChanged(m, 'type', track.type);

  if (track.gain !== undefined) {
    setIfChanged(m, 'gain', track.gain);
  } else {
    deleteIfPresent(m, 'gain');
  }

  if (track.autoDuck !== undefined) {
    setIfChanged(m, 'autoDuck', track.autoDuck);
  } else {
    deleteIfPresent(m, 'autoDuck');
  }

  let yClips = m.get('clips') as Y.Array<Y.Map<any>> | undefined;
  if (!yClips) {
    yClips = new Y.Array<Y.Map<any>>();
    m.set('clips', yClips);
  }
  syncArrayById(yClips, track.clips, createClipMap, syncClipMap, lastTrack?.clips);
}

const CLIP_SCALAR_KEYS: (keyof VideoClip)[] = [
  'startMs',
  'endMs',
  'trimInMs',
  'trimOutMs',
  'src',
  'fileId',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'text',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fill',
  'volume',
  'fadeInMs',
  'fadeOutMs',
  'naturalWidth',
  'naturalHeight',
  'speed',
  'reverse',
  'freezeAtMs',
  'filters',
];

function createClipMap(): Y.Map<any> {
  return new Y.Map<any>();
}

function syncClipMap(
  m: Y.Map<any>,
  clip: VideoClip,
  lastClip?: VideoClip
): void {
  setIfChanged(m, 'id', clip.id);

  for (const key of CLIP_SCALAR_KEYS) {
    const val = clip[key];
    if (val !== undefined) {
      if (m.get(key) !== val) {
        m.set(key, val);
      }
    } else if (m.has(key)) {
      m.delete(key);
    }
  }

  if (clip.transitionIn) {
    const serialized = JSON.stringify(clip.transitionIn);
    setIfChanged(m, 'transitionIn', serialized);
  } else {
    deleteIfPresent(m, 'transitionIn');
  }

  if (clip.transitionOut) {
    const serialized = JSON.stringify(clip.transitionOut);
    setIfChanged(m, 'transitionOut', serialized);
  } else {
    deleteIfPresent(m, 'transitionOut');
  }

  if (clip.frames) {
    setIfChanged(m, 'frames', JSON.stringify(clip.frames));
  } else {
    deleteIfPresent(m, 'frames');
  }

  if (clip.words) {
    setIfChanged(m, 'words', JSON.stringify(clip.words));
  } else {
    deleteIfPresent(m, 'words');
  }

  let yKeyframes = m.get('keyframes') as Y.Array<Y.Map<any>> | undefined;
  if (!yKeyframes) {
    yKeyframes = new Y.Array<Y.Map<any>>();
    m.set('keyframes', yKeyframes);
  }
  syncKeyframes(yKeyframes, clip.keyframes ?? []);
}

function createKeyframeMap(kf: VideoClip['keyframes'][number]): Y.Map<any> {
  const m = new Y.Map<any>();
  m.set('tMs', kf.tMs);
  m.set('ease', kf.ease ?? 'linear');
  m.set('props', JSON.stringify(kf.props));
  return m;
}

function syncKeyframeMap(
  m: Y.Map<any>,
  kf: VideoClip['keyframes'][number]
): void {
  setIfChanged(m, 'tMs', kf.tMs);
  setIfChanged(m, 'ease', kf.ease ?? 'linear');
  const propsStr = JSON.stringify(kf.props);
  setIfChanged(m, 'props', propsStr);
}

function syncKeyframes(
  yArr: Y.Array<Y.Map<any>>,
  keyframes: NonNullable<VideoClip['keyframes']>
): void {
  const current = yArr.toArray();
  for (let i = 0; i < keyframes.length; i++) {
    if (i < current.length) {
      syncKeyframeMap(current[i], keyframes[i]);
    } else {
      yArr.push([createKeyframeMap(keyframes[i])]);
    }
  }
  while (yArr.length > keyframes.length) {
    yArr.delete(yArr.length - 1);
  }
}

export function syncVideoDocToY(
  docMap: Y.Map<any>,
  doc: DesignerDoc,
  lastDoc: DesignerDoc | null
): void {
  const lastOutputs =
    lastDoc?.mode === 'video' ? (lastDoc.outputs as VideoOutput[]) : undefined;

  docMap.set(Y_MODE, doc.mode);
  docMap.set(Y_VERSION, doc.version);
  docMap.set(
    Y_ATTRIBUTION,
    doc.attribution ? JSON.stringify(doc.attribution) : null
  );

  if (docMap.has(Y_DATA)) {
    docMap.delete(Y_DATA);
  }

  let yOutputs = docMap.get(Y_OUTPUTS) as Y.Array<Y.Map<any>> | undefined;
  if (!yOutputs) {
    yOutputs = new Y.Array<Y.Map<any>>();
    docMap.set(Y_OUTPUTS, yOutputs);
  }

  syncArrayById(
    yOutputs,
    doc.outputs as VideoOutput[],
    createOutputMap,
    syncOutputMap,
    lastOutputs
  );
}

function yToVideoOutput(m: Y.Map<any>): VideoOutput {
  const yTracks = m.get('tracks') as Y.Array<Y.Map<any>> | undefined;
  return {
    id: m.get('id'),
    formatId: m.get('formatId'),
    name: m.get('name'),
    width: m.get('width'),
    height: m.get('height'),
    fps: m.get('fps'),
    durationMs: m.get('durationMs'),
    tracks: (yTracks?.toArray() ?? []).map(yToVideoTrack),
  };
}

function yToVideoTrack(m: Y.Map<any>): VideoTrack {
  const yClips = m.get('clips') as Y.Array<Y.Map<any>> | undefined;
  return {
    id: m.get('id'),
    type: m.get('type'),
    gain: m.get('gain'),
    autoDuck: m.get('autoDuck'),
    clips: (yClips?.toArray() ?? []).map(yToVideoClip),
  };
}

function yToVideoClip(m: Y.Map<any>): VideoClip {
  const clip: VideoClip = {
    id: m.get('id'),
    startMs: m.get('startMs'),
    endMs: m.get('endMs'),
  };

  for (const key of CLIP_SCALAR_KEYS) {
    if (key === 'id' || key === 'startMs' || key === 'endMs') continue;
    if (m.has(key)) {
      (clip as any)[key] = m.get(key);
    }
  }

  if (m.has('transitionIn')) {
    clip.transitionIn = JSON.parse(m.get('transitionIn'));
  }
  if (m.has('transitionOut')) {
    clip.transitionOut = JSON.parse(m.get('transitionOut'));
  }

  if (m.has('frames')) {
    try {
      clip.frames = JSON.parse(m.get('frames'));
    } catch {}
  }

  if (m.has('words')) {
    try {
      clip.words = JSON.parse(m.get('words'));
    } catch {}
  }

  const yKeyframes = m.get('keyframes') as Y.Array<Y.Map<any>> | undefined;
  if (yKeyframes && yKeyframes.length > 0) {
    clip.keyframes = yKeyframes.toArray().map(yToKeyframe);
  }

  return clip;
}

function yToKeyframe(m: Y.Map<any>): VideoClip['keyframes'][number] {
  return {
    tMs: m.get('tMs'),
    ease: m.get('ease'),
    props: JSON.parse(m.get('props')),
  };
}

export function rebuildDocFromY(docMap: Y.Map<any>): DesignerDoc | null {
  const mode = docMap.get(Y_MODE);
  if (mode === 'video') {
    const yOutputs = docMap.get(Y_OUTPUTS) as Y.Array<Y.Map<any>> | undefined;
    if (!yOutputs) return null;

    let attribution: DesignerAttribution | undefined;
    const attrRaw = docMap.get(Y_ATTRIBUTION);
    if (attrRaw) {
      try {
        attribution = JSON.parse(attrRaw);
      } catch {
        // ignore
      }
    }

    return {
      version: docMap.get(Y_VERSION) ?? 2,
      mode: 'video',
      outputs: yOutputs.toArray().map(yToVideoOutput),
      attribution,
    };
  }

  // Image mode: legacy whole-doc JSON string preserved for back-compat.
  const raw = docMap.get(Y_DATA);
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export function useCollaboration({
  designId,
  enabled,
  onRemoteDoc,
  onConnectedChange,
  onPeerTimeline,
  onPeerImage,
}: UseCollaborationOptions) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(
    `client-${Date.now()}-${++clientCounter}`
  );
  const awarenessMapRef = useRef<Map<string, TimelineAwareness | ImageAwareness>>(
    new Map()
  );
  const mountedRef = useRef(true);
  const lastSentDocRef = useRef<DesignerDoc | null>(null);
  const lastRebuiltDocRef = useRef<DesignerDoc | null>(null);
  const wsConnectedRef = useRef(false);

  // 4.4: peer awareness is stamped with `ts`; entries not refreshed within this
  // window are treated as ghost peers from an ungraceful disconnect and pruned.
  const AWARENESS_STALE_MS = 30_000;

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !designId) return;

    const roomName = `design_${designId}`;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    const docMap = ydoc.getMap(Y_DOC);
    const awarenessMap = ydoc.getMap(Y_AWARENESS);

    // 4.4: single origin-tagged update observer.
    // - local edits: broadcast ONLY the incremental delta (not the whole doc)
    //   to the room, matching the Yjs idiom and keeping payloads O(change).
    // - remote edits (applied via ws.onmessage with no origin): rebuild the doc.
    const handleYUpdate = (update: Uint8Array, origin: any) => {
      if (origin === 'local') {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(update);
        }
        return;
      }
      if (!mountedRef.current) return;

      const rebuilt = rebuildDocFromY(docMap);
      if (!rebuilt) return;
      if (deepEqual(lastRebuiltDocRef.current, rebuilt)) return;

      lastRebuiltDocRef.current = deepClone(rebuilt);
      lastSentDocRef.current = deepClone(rebuilt);
      onRemoteDoc(rebuilt);
    };

    ydoc.on('update', handleYUpdate);

    // 4.4: recompute the REAL connected count = self (when the socket is up) +
    // distinct non-stale peer awareness entries, and hand fresh peer awareness
    // to the callbacks (pruning ghost peers).
    const recompute = () => {
      const now = Date.now();
      const timelinePeers: TimelineAwareness[] = [];
      const imagePeers: ImageAwareness[] = [];
      const stale: string[] = [];
      const peerIds = new Set<string>();
      awarenessMap.forEach((val, key) => {
        if (key === clientIdRef.current || typeof val !== 'string') return;
        try {
          const parsed = JSON.parse(val);
          if (typeof parsed.ts === 'number' && now - parsed.ts > AWARENESS_STALE_MS) {
            stale.push(key);
            return;
          }
          peerIds.add(key);
          if (parsed.type === 'timeline') {
            timelinePeers.push(parsed);
          } else if (parsed.type === 'image') {
            imagePeers.push(parsed);
          }
        } catch {
          // ignore malformed awareness
        }
      });

      if (stale.length) {
        ydoc.transact(() => {
          for (const key of stale) awarenessMap.delete(key);
        }, 'local');
      }

      onPeerTimeline?.(timelinePeers);
      onPeerImage?.(imagePeers);
      onConnectedChange?.((wsConnectedRef.current ? 1 : 0) + peerIds.size);
    };

    awarenessMap.observe(recompute);

    // 4.4: dev routing — the collaboration gateway lives on the BACKEND HTTP
    // server, not the Next dev port. Point at NEXT_PUBLIC_BACKEND_URL's origin
    // when set (dev), else same-origin (prod, where the app and gateway share it).
    const backendBase = process.env.NEXT_PUBLIC_BACKEND_URL;
    let wsHost = location.host;
    let wsSecure = location.protocol === 'https:';
    if (backendBase) {
      try {
        const u = new URL(backendBase);
        wsHost = u.host;
        wsSecure = u.protocol === 'https:';
      } catch {
        // fall back to same-origin
      }
    }
    const protocol = wsSecure ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${wsHost}/collaboration?room=${roomName}`;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!mountedRef.current) return;

      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        wsConnectedRef.current = true;
        recompute();
        // Push our local Yjs state so the server/room catches up with any
        // edits made while disconnected (offline-edit merge, T-37.4). This is
        // the ONE full-state send — steady-state edits go out as deltas.
        if (ydocRef.current && ws.readyState === WebSocket.OPEN) {
          ws.send(Y.encodeStateAsUpdate(ydocRef.current));
        }
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer && ydocRef.current) {
          Y.applyUpdate(ydocRef.current, new Uint8Array(event.data));
        }
      };

      ws.onerror = () => {
        // no-op: onclose will schedule reconnect
      };

      ws.onclose = () => {
        wsConnectedRef.current = false;
        onConnectedChange?.(0);
        awarenessMapRef.current.clear();
        wsRef.current = null;
        if (mountedRef.current && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 2000);
        }
      };
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      // 4.4: delete our own awareness BEFORE closing so peers prune us
      // immediately (the local-origin delta rides out on the still-open socket).
      try {
        if (awarenessMap.has(clientIdRef.current)) {
          ydoc.transact(() => awarenessMap.delete(clientIdRef.current), 'local');
        }
      } catch {
        // ignore
      }
      wsConnectedRef.current = false;
      wsRef.current?.close();
      ydoc.off('update', handleYUpdate);
      ydoc.destroy();
      onConnectedChange?.(0);
      awarenessMapRef.current.clear();
      lastSentDocRef.current = null;
      lastRebuiltDocRef.current = null;
    };
  }, [
    designId,
    enabled,
    onRemoteDoc,
    onConnectedChange,
    onPeerTimeline,
    onPeerImage,
  ]);

  const sendUpdate = useCallback(
    (doc: DesignerDoc) => {
      const ydoc = ydocRef.current;
      if (!ydoc) return;

      if (lastSentDocRef.current && deepEqual(lastSentDocRef.current, doc)) {
        return;
      }

      const lastDoc = lastSentDocRef.current;
      lastSentDocRef.current = deepClone(doc);

      const docMap = ydoc.getMap(Y_DOC);

      // 4.4: transact with a 'local' origin — the update observer forwards the
      // resulting incremental delta to the room (no whole-doc encode here).
      ydoc.transact(() => {
        if (doc.mode === 'video') {
          syncVideoDocToY(docMap, doc, lastDoc);
        } else {
          docMap.set(Y_MODE, doc.mode);
          docMap.set(Y_VERSION, doc.version);
          docMap.set(
            Y_ATTRIBUTION,
            doc.attribution ? JSON.stringify(doc.attribution) : null
          );
          docMap.set(Y_DATA, JSON.stringify(doc));
          if (docMap.has(Y_OUTPUTS)) {
            docMap.delete(Y_OUTPUTS);
          }
        }
      }, 'local');
    },
    []
  );

  const sendTimelineAwareness = useCallback(
    (playheadMs: number, selectedClipId: string | null) => {
      const ydoc = ydocRef.current;
      if (!ydoc) return;

      const awareness: TimelineAwareness & { ts: number } = {
        type: 'timeline',
        playheadMs,
        selectedClipId,
        clientId: clientIdRef.current,
        ts: Date.now(),
      };

      // 4.4: 'local' transact → observer broadcasts just this awareness delta.
      ydoc.transact(() => {
        const awarenessMap = ydoc.getMap(Y_AWARENESS);
        awarenessMap.set(clientIdRef.current, JSON.stringify(awareness));
      }, 'local');
    },
    []
  );

  const sendImageAwareness = useCallback(
    (
      outputIndex: number,
      mouseX: number,
      mouseY: number,
      selectedIds: string[]
    ) => {
      const ydoc = ydocRef.current;
      if (!ydoc) return;

      const awareness: ImageAwareness & { ts: number } = {
        type: 'image',
        clientId: clientIdRef.current,
        outputIndex,
        mouseX,
        mouseY,
        selectedIds,
        ts: Date.now(),
      };

      // 4.4: 'local' transact → observer broadcasts just this awareness delta.
      ydoc.transact(() => {
        const awarenessMap = ydoc.getMap(Y_AWARENESS);
        awarenessMap.set(clientIdRef.current, JSON.stringify(awareness));
      }, 'local');
    },
    []
  );

  return { sendUpdate, sendTimelineAwareness, sendImageAwareness };
}
