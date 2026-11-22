/**
 * States of an audio row: `pending` waits for synthesis, `ready` can be played, and `retiring`
 * has its object being deleted from the bucket.
 */
export const AUDIO_STATES = ['pending', 'ready', 'retiring'] as const;

export type AudioState = (typeof AUDIO_STATES)[number];
