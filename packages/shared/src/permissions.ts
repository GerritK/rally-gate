import { AccessRole } from './auth';
import { EntryStatus } from './entry';

/**
 * Who besides the organiser may do what (`docs/auth.md`). One table for both
 * sides: rally-server's `@Roles` reads it, and the dashboard hides what
 * `mayDo` refuses, so a shown button is never answered with a 403.
 * An empty list is the organiser's alone.
 */
export const PERMISSIONS = {
  /** Event, stages, classes, scoring, display, start order, gates. */
  setup: [],
  /** Activate and close a stage. */
  activateStage: [AccessRole.TIMING],
  /** Start now, a typed start, Finish now. */
  timeRun: [AccessRole.TIMING, AccessRole.STAGE_MARSHAL],
  correctRun: [AccessRole.TIMING, AccessRole.STAGE_MARSHAL],
  /** Void, unvoid, delete an attempt. */
  voidRun: [AccessRole.TIMING],
  /** Assign or dismiss an unidentified passing. */
  assignPassing: [AccessRole.TIMING, AccessRole.STAGE_MARSHAL],
  retryPending: [AccessRole.TIMING],
  penalties: [AccessRole.TIMING],
  /** Register, edit, transponders, check in, scrutineering. */
  editEntry: [AccessRole.CHECK_IN],
  withdrawEntry: [AccessRole.CHECK_IN, AccessRole.TIMING],
  /** A jury decision: every result behind the car moves. */
  disqualifyEntry: [],
} satisfies Record<string, AccessRole[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Whether a login may do it. A stage marshal only on the stages of its
 * invitation, so where it is one, pass the stage: without it a marshal may
 * not. `role` null is nobody logged in.
 */
export function mayDo(
  login: { role: AccessRole | null; stageIds: string[] },
  permission: Permission,
  stageId?: string | null,
): boolean {
  if (!login.role) return false;
  if (login.role === AccessRole.ORGANISER) return true;
  if (!(PERMISSIONS[permission] as AccessRole[]).includes(login.role)) {
    return false;
  }
  return (
    login.role !== AccessRole.STAGE_MARSHAL ||
    (!!stageId && login.stageIds.includes(stageId))
  );
}

/** What moving an entry from `from` to `to` needs. */
export function entryStatusPermission(
  from: EntryStatus,
  to: EntryStatus,
): Permission {
  if (from === to) return 'editEntry';
  if (from === EntryStatus.DISQUALIFIED || to === EntryStatus.DISQUALIFIED) {
    return 'disqualifyEntry';
  }
  if (from === EntryStatus.WITHDRAWN || to === EntryStatus.WITHDRAWN) {
    return 'withdrawEntry';
  }
  return 'editEntry';
}
