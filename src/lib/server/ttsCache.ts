import { TtlCache } from "./cache";

export interface CachedAudio {
  audio: Buffer;
  type: string;
  voice: string;
}

/** Synthesized speech cached for an hour so repeated phrases ("Yes?", replays) cost nothing. */
export class TtsCache extends TtlCache<CachedAudio> {
  constructor() {
    super(200, 60 * 60_000);
  }
}
