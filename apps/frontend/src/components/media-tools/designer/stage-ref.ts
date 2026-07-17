import type Konva from 'konva';

/**
 * Shared mutable reference to the active Konva Stage so panels (e.g. the text
 * inspector) can export the canvas without prop-drilling through every layer.
 * The canvas sets this; panels read it defensively and fall back when absent.
 */
export const sharedStageRef = {
  current: null as Konva.Stage | null,
};
