/**
 * `transponderId` is undefined for a sensor that can't identify the car.
 * `metadata` is stored with the detection as evidence; nothing times from it.
 */
export type DetectionCallback = (
  transponderId: string | undefined,
  timestamp: Date,
  metadata?: Record<string, unknown>,
) => void;

/**
 * `onSense` fires the moment the sensor that times a passing triggers, for the
 * buzzer: a combined gate publishes only once beam and read are paired, which
 * is too late to tell a marshal the car was seen.
 */
export interface DecoderAdapter {
  start(
    onDetection: DetectionCallback,
    onSense?: () => void,
  ): void | Promise<void>;
  stop(): void | Promise<void>;
}
