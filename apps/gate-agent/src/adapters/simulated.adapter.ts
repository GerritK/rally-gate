import { DecoderAdapter, DetectionCallback } from './decoder-adapter';

export interface SimulatedAdapterOptions {
  transponderIds: string[];
  intervalMs?: number;
}

export class SimulatedAdapter implements DecoderAdapter {
  private timer?: NodeJS.Timeout;

  constructor(private readonly options: SimulatedAdapterOptions) {}

  start(onDetection: DetectionCallback): void {
    if (!this.options.intervalMs) {
      return;
    }
    let i = 0;
    this.timer = setInterval(() => {
      const transponderId = this.options.transponderIds[i % this.options.transponderIds.length];
      i += 1;
      onDetection(transponderId, new Date());
    }, this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
