export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AttentionActionType = 'retry-post' | 'dismiss-anomaly' | 'navigate';

export interface AttentionItemDto {
  id: string;
  kind: string;
  severity: AttentionSeverity;
  title: string;
  description?: string;
  count?: number;
  link: string;
  action?: {
    label: string;
    type: AttentionActionType;
    payload?: Record<string, any>;
  };
}

export interface AttentionResponseDto {
  items: AttentionItemDto[];
}
