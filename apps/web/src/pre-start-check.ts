import {
  GateRole,
  isOutOfEvent,
  StageScoring,
  StageStatus,
  type EntryStatus,
} from '@rally-gate/shared';

// Structural types rather than the API modules': this file runs under
// `node --test`, where those (Vite's import.meta.env) can't load.
export interface CheckStage {
  id: string;
  status: StageStatus;
  scoring: StageScoring;
}
export interface CheckAssignment {
  gateId: string;
  stageId: string;
  role: GateRole;
}
/** `ready` as `isReady` in `format.ts` says, worked out by the caller. */
export interface CheckGate {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
}
export interface CheckEntry {
  startNumber: number;
  status: EntryStatus;
  transponders: { kind: string; identifier: string }[];
  classes: unknown[];
}

/** `key` is a message key under `rally.check`; an error blocks Start rally. */
export interface CheckFinding {
  error: boolean;
  key: string;
  params: Record<string, string>;
}

const STARTS = [GateRole.STAGE_START, GateRole.STAGE_START_FINISH];
const FINISHES = [GateRole.STAGE_FINISH, GateRole.STAGE_START_FINISH];

const numbers = (entries: CheckEntry[]) =>
  entries
    .map((e) => e.startNumber)
    .sort((a, b) => a - b)
    .map((n) => `#${n}`)
    .join(', ');

/**
 * Before Start rally. Errors only where starting makes no sense at all;
 * the rest warns, since a marshal knows things the check doesn't (a stage
 * timed by hand, a gate still on its way to the stage).
 */
export function preStartCheck(input: {
  stages: CheckStage[];
  assignments: CheckAssignment[];
  gates: CheckGate[];
  entries: CheckEntry[];
  anyClass: boolean;
}): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const add = (error: boolean, key: string, params: Record<string, string>) =>
    findings.push({ error, key, params });
  const entries = input.entries.filter((e) => !isOutOfEvent(e.status));
  const stages = input.stages.filter((s) => s.status !== StageStatus.CLOSED);

  if (entries.length === 0) add(true, 'noEntries', {});
  if (!stages.some((s) => s.scoring === StageScoring.OVERALL)) {
    add(true, 'noCountedStage', {});
  }

  const missing = (roles: GateRole[]) =>
    stages
      .filter(
        (s) =>
          !input.assignments.some(
            (a) => a.stageId === s.id && roles.includes(a.role),
          ),
      )
      .map((s) => s.id)
      .join(', ');
  const noStart = missing(STARTS);
  if (noStart) add(false, 'noStartGate', { stages: noStart });
  const noFinish = missing(FINISHES);
  if (noFinish) add(false, 'noFinishGate', { stages: noFinish });

  const planned = input.gates.filter((g) =>
    input.assignments.some(
      (a) => a.gateId === g.id && stages.some((s) => s.id === a.stageId),
    ),
  );
  const names = (gates: CheckGate[]) =>
    gates.map((g) => g.name || g.id).join(', ');
  const offline = planned.filter((g) => !g.online);
  if (offline.length) add(false, 'gatesOffline', { gates: names(offline) });
  const unsynced = planned.filter((g) => g.online && !g.ready);
  if (unsynced.length) add(false, 'gatesUnsynced', { gates: names(unsynced) });

  const bare = entries.filter((e) => e.transponders.length === 0);
  if (bare.length) add(false, 'noTransponder', { numbers: numbers(bare) });
  const carriers = new Map<string, CheckEntry[]>();
  for (const entry of entries) {
    for (const t of entry.transponders) {
      const key = `${t.kind} ${t.identifier}`;
      carriers.set(key, [...(carriers.get(key) ?? []), entry]);
    }
  }
  for (const [transponder, cars] of carriers) {
    if (cars.length > 1) {
      add(false, 'sharedTransponder', {
        transponder: transponder.split(' ')[1],
        numbers: numbers(cars),
      });
    }
  }

  const classless = entries.filter((e) => e.classes.length === 0);
  if (input.anyClass && classless.length) {
    add(false, 'noClass', { numbers: numbers(classless) });
  }
  return findings.sort((a, b) => Number(b.error) - Number(a.error));
}
