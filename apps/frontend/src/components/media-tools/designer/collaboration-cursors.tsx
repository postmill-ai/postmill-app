import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { ImageAwareness } from './collaboration';

export interface PeerTimelineState {
  playheadMs: number;
  selectedClipId: string | null;
  color: string;
}

interface Props {
  connectedCount: number;
  peers?: PeerTimelineState[];
  peerImages?: ImageAwareness[];
  mode?: 'image' | 'video';
  durationMs?: number;
  store?: any;
}

const PEER_COLORS = ['#f43f5e', '#8b5cf6', '#06b6d4', '#f59e0b', '#22c55e', '#ec4899'];

const colorForIndex = (i: number) => PEER_COLORS[i % PEER_COLORS.length];

export const CollaborationCursors: React.FC<Props> = ({
  connectedCount,
  peers,
  peerImages,
  mode,
  durationMs,
  store,
}) => {
  const t = useT();
  if (connectedCount <= 1) return null;

  if (mode === 'video' && peers && durationMs) {
    return (
      <div className="absolute inset-0 pointer-events-none z-50">
        <div className="absolute top-2 right-2 bg-green-500/20 border border-green-500/30 rounded px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
          {t('peers_connected_count', '{{count}} connected', { count: connectedCount })}
        </div>
        {peers.map((peer, i) => (
          <div key={i} className="absolute bottom-0 left-0 right-0 z-40" style={{ bottom: '6px' }}>
            <div
              className="absolute top-0 bottom-0 w-0.5"
              style={{
                left: `${(peer.playheadMs / durationMs) * 100}%`,
                backgroundColor: peer.color || colorForIndex(i),
                opacity: 0.7,
              }}
              title={t('peer_playhead_ms', 'Peer playhead: {{ms}}ms', { ms: peer.playheadMs })}
            >
              <div
                className="w-2 h-2 rotate-45 -translate-x-1/2 -translate-y-full"
                style={{ backgroundColor: peer.color || colorForIndex(i) }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Image mode: render per-user cursors and selection indicators.
  const currentOutput = store ? (store.getState().currentOutput as number) : 0;
  const output = store
    ? (store.getState().doc.outputs[currentOutput] as any)
    : null;

  return (
    <div className="absolute inset-0 pointer-events-none z-50">
      <div className="absolute top-2 right-2 bg-green-500/20 border border-green-500/30 rounded px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
        {t('peers_connected_count', '{{count}} connected', { count: connectedCount })}
      </div>

      {peerImages?.map((peer, i) => {
        const color = colorForIndex(i);
        const isSameOutput = peer.outputIndex === currentOutput;
        const selectedBoxes = isSameOutput
          ? (output?.children || [])
              .filter((c: any) => peer.selectedIds?.includes(c.id))
              .map((c: any) => c)
          : [];

        return (
          <React.Fragment key={peer.clientId || i}>
            <div
              className="absolute z-40"
              style={{
                left: `${peer.mouseX}px`,
                top: `${peer.mouseY}px`,
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill={color}
                style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.4))' }}
              >
                <path d="M3 3l8 20 3-9 9-3L3 3z" />
              </svg>
              <span
                className="absolute left-3 top-3 px-1.5 py-0.5 rounded text-[10px] text-white whitespace-nowrap"
                style={{ backgroundColor: color }}
              >
                {t('peer_number', 'Peer {{n}}', { n: i + 1 })}
                {peer.selectedIds?.length
                  ? t('peer_selected_count', ' · {{count}} selected', { count: peer.selectedIds.length })
                  : ''}
              </span>
            </div>

            {selectedBoxes.map((el: any) => (
              <div
                key={`${peer.clientId || i}-${el.id}`}
                className="absolute border-2 border-dashed rounded"
                style={{
                  left: `${el.x}px`,
                  top: `${el.y}px`,
                  width: `${el.width}px`,
                  height: `${el.height}px`,
                  borderColor: color,
                  backgroundColor: `${color}10`,
                }}
              />
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
};
