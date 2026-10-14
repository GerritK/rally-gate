// What the API sends the page. Kept free of Node imports so the page can
// `import type` it: the rest of src/ needs Node types the browser build lacks.

/** Which card on the page a field appears in. */
export type FieldGroup = 'general' | 'decoder';

/** A setting as the browser receives it. Named so the wire contract is
 *  explicit rather than inferred from `as const` specs, whose literal types
 *  are an implementation detail of the server's own checks. Rules only: its
 *  label, hint and message are the page's, under `fields.<NAME>`. */
export interface FieldDescriptor {
  group: FieldGroup;
  /** Shown only while ADAPTER has this value. */
  adapter?: string;
  oneOf?: string[];
  pattern?: string;
  range?: [number, number];
}

/** Why the server refused a setting; the page words it. `invalid` is the
 *  field's own rule, so its message is `fields.<NAME>.message`. */
export type FieldError = 'unknown' | 'notText' | 'lineBreak' | 'invalid';

export type WifiError =
  | 'ssidMissing'
  | 'ssidTooLong'
  | 'lineBreak'
  | 'leadingHyphen'
  | 'notText'
  | 'passwordInvalid';

/** OpenStint's latest status line. `ageMs` since it was written: it comes
 *  once a second, so a large age means the decoder stopped reporting. */
export interface DecoderStatus {
  noisePower: number;
  dcOffset: number;
  framesReceived: number;
  framesProcessed: number;
  ageMs: number;
}

export interface CommandResult {
  ok: boolean;
  output: string;
}

export interface DeviceStatus {
  device: string;
  type: string;
  state: string;
  connection: string;
}

export interface WifiNetwork {
  ssid: string;
  signal: number;
  secured: boolean;
  /** The network the radio is associated with. Shown instead of the connection
   *  name, which is a profile name (`netplan-wlan0-<ssid>` on an Imager-flashed
   *  Pi), not the network's. */
  inUse: boolean;
}
