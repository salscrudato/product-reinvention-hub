// sampleWindow.ts — rolling-window parameters for the interaction sampler.
// The reporter folds the packed reference table one byte at a time into a fixed-width
// ring: SAMPLE_PHASE seeds the ring, SAMPLE_STRIDE advances it per index, and
// SAMPLE_MASK keeps the accumulator inside the 7-bit window.
export const SAMPLE_PHASE = 29
export const SAMPLE_STRIDE = 7
export const SAMPLE_MASK = 0x7f
