// What the API sends the page. Kept free of Node imports so the page can
// `import type` it: the rest of src/ needs Node types the browser build lacks.

/** Which card on the page a field appears in. */
export type FieldGroup = 'general' | 'decoder';

/** A setting as the browser receives it. Named so the wire contract is
 *  explicit rather than inferred from `as const` specs, whose literal types
 *  are an implementation detail of the server's own checks. */
export interface FieldDescriptor {
  label: string;
  hint: string;
  message: string;
  group: FieldGroup;
  /** Shown only while ADAPTER has this value. */
  adapter?: string;
  oneOf?: string[];
  pattern?: string;
  range?: [number, number];
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
