import type {
  DesignerSuggestionAction,
  DesignerSuggestionScope,
} from './designer-assistant-actions';

export interface DesignerAssistantSuggestion {
  category: 'font' | 'color' | 'layout' | 'spacing';
  title: string;
  rationale: string;
  style?: { fontFamily?: string; fill?: string };
  action?: DesignerSuggestionAction;
}

export interface DesignerAssistantSuggestionEntry {
  suggestions: DesignerAssistantSuggestion[];
  scope: DesignerSuggestionScope;
}

export const designerAssistantClipKey = (target: {
  outputIndex: number;
  trackId: string;
  clipId: string;
}): string => `clip:${target.outputIndex}:${target.trackId}:${target.clipId}`;
