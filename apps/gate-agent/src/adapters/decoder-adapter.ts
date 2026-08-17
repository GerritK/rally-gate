export type DetectionCallback = (
  transponderId: string,
  timestamp: Date,
) => void;

export interface DecoderAdapter {
  start(onDetection: DetectionCallback): void | Promise<void>;
  stop(): void | Promise<void>;
}
