/** `transponderId` is undefined for a sensor that can't identify the car. */
export type DetectionCallback = (
  transponderId: string | undefined,
  timestamp: Date,
) => void;

export interface DecoderAdapter {
  start(onDetection: DetectionCallback): void | Promise<void>;
  stop(): void | Promise<void>;
}
