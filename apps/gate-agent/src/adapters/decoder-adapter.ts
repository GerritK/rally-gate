/**
 * `transponderId` is undefined for a sensor that can't identify the car.
 * `metadata` is stored with the detection as evidence; nothing times from it.
 */
export type DetectionCallback = (
  transponderId: string | undefined,
  timestamp: Date,
  metadata?: Record<string, unknown>,
) => void;

export interface DecoderAdapter {
  start(onDetection: DetectionCallback): void | Promise<void>;
  stop(): void | Promise<void>;
}
