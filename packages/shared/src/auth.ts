/**
 * What a login may change (`docs/auth.md` "Who sees what"). The organiser is
 * also whoever uses the server machine itself.
 */
export enum AccessRole {
  ORGANISER = 'ORGANISER',
  TIMING = 'TIMING',
  /** Only the stages on its invitation. */
  STAGE_MARSHAL = 'STAGE_MARSHAL',
  CHECK_IN = 'CHECK_IN',
}

/** `GET /api/auth/session`: who this browser is. */
export interface AuthSession {
  /** Null: not logged in. */
  role: AccessRole | null;
  /** Null for the server machine itself, which needs no device. */
  deviceId: string | null;
  /** The invitation's label, null for the organiser. */
  label: string | null;
  /** Counts the invitation's devices, for "Anna – Start SS2 · device 2". */
  deviceNumber: number | null;
  /** Stage marshals only; empty otherwise. */
  stageIds: string[];
  /** Whether the organiser password is set, so a page can offer setting it. */
  passwordSet: boolean;
}

export interface Invitation {
  id: string;
  label: string;
  role: AccessRole;
  stageIds: string[];
  /** What the QR code carries and a marshal types when the camera fails. */
  code: string;
  blocked: boolean;
  createdAt: string;
}

export interface AuthDevice {
  id: string;
  /** Null: logged in with the organiser password. */
  invitationId: string | null;
  number: number;
  blocked: boolean;
  createdAt: string;
}
