// Scale (natW × natH) down to fit inside (maxW × maxH) using a single uniform
// factor, so the image's real aspect ratio (and orientation) is preserved.
// Independent per-axis clamping flips a portrait image to landscape in a
// non-square doc — this keeps it portrait.
//
// Re-exported from the shared `designer-doc` layer (used by the server-side
// reflow too) so the two implementations can't diverge.
export { fitWithin } from '@gitroom/nestjs-libraries/media/designer-doc/reflow';
