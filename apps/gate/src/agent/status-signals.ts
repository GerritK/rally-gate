import type { BuzzerSignal } from '@rally-gate/shared';

/** Under this a WLAN hiccup heals unheard: mqtt.js reconnects within seconds. */
export const LOST_AFTER_MS = 15_000;
export const CLOCK_BAD_AFTER_MS = 60_000;

/** `pending` until the first reading; an unreadable clock is `ok`, not a warning. */
export type ClockState = 'pending' | 'ok' | 'bad';

export interface GateState {
  connected: boolean;
  decoderRunning: boolean;
  clock: ClockState;
}

/**
 * Which status signal a marshal should hear next. Polled with the current
 * state rather than fed events, so the same rules fit the ESP32 firmware
 * (`gate::StatusTracker` in lib/gate_core) and need no timers.
 *
 * `ready` means this gate would time correctly: connected, decoder running,
 * clock synced. It repeats after every `connectionLost` and `clockUnsynced`.
 * Nothing is said about a server that was never reached: the missing `ready`
 * is the signal.
 */
export class StatusSignals {
  private needReady = true;
  private everConnected = false;
  private downSince = -1;
  private lostAnnounced = false;
  private clockBadSince = -1;
  private clockAnnounced = false;

  next(now: number, state: GateState): BuzzerSignal | undefined {
    if (state.connected) {
      this.everConnected = true;
      this.downSince = -1;
      if (this.lostAnnounced) {
        this.lostAnnounced = false;
        this.needReady = true;
      }
    } else if (this.everConnected && !this.lostAnnounced) {
      this.downSince = this.downSince < 0 ? now : this.downSince;
      if (now - this.downSince >= LOST_AFTER_MS) {
        this.lostAnnounced = true;
        return 'connectionLost';
      }
    }

    if (state.clock === 'bad') {
      this.clockBadSince = this.clockBadSince < 0 ? now : this.clockBadSince;
      if (
        !this.clockAnnounced &&
        now - this.clockBadSince >= CLOCK_BAD_AFTER_MS
      ) {
        this.clockAnnounced = true;
        return 'clockUnsynced';
      }
    } else if (state.clock === 'ok') {
      this.clockBadSince = -1;
      if (this.clockAnnounced) {
        this.clockAnnounced = false;
        this.needReady = true;
      }
    }

    if (
      this.needReady &&
      state.connected &&
      state.decoderRunning &&
      state.clock === 'ok'
    ) {
      this.needReady = false;
      return 'ready';
    }
    return undefined;
  }
}
