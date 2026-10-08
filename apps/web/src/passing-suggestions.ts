import { GateRole } from '@rally-gate/shared';

// Structural types rather than the API modules': this file runs under
// `node --test`, where those (Vite's import.meta.env) can't load.
export interface Passing {
  eventId: string;
  gateId: string;
  timestampGate: string;
  transponderId: string | null;
  transponderKind: string | null;
}
export interface PlannedGate {
  gateId: string;
  stageId: string;
  role: GateRole;
  splitIndex?: number;
  active: boolean;
}
export interface Carrier {
  id: string;
  transponders: { kind: string; identifier: string }[];
}
export interface CarOnStage {
  entryId: string;
  runId: string;
  startTime: string;
}

interface Candidate {
  entryId: string;
  runId?: string;
}

/** A passing held because its transponder is on several cars is one of
 *  those cars. Undefined (any car) for a beam passing, or once the
 *  transponder has since moved and matches none. */
export function carriersOf(
  entries: Carrier[],
  passing: Passing,
): Set<string> | undefined {
  const ids = entries
    .filter((e) =>
      e.transponders.some(
        (t) =>
          t.kind === passing.transponderKind &&
          t.identifier === passing.transponderId,
      ),
    )
    .map((e) => e.id);
  return ids.length > 0 ? new Set(ids) : undefined;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * A suggestion only pre-selects, it never assigns: a wrong assignment is a
 * wrong time nobody notices in the results. Passings are matched in time
 * order — at a start gate to the cars due to start in start order, at a split
 * or finish to the cars on stage in expected arrival order — each car
 * suggested once. Passings at another stage's gates get no suggestion; the
 * page only knows its stage. Returns entry ids by passing `eventId`.
 */
export function suggestEntries(input: {
  passings: Passing[];
  gates: PlannedGate[];
  stageId: string | undefined;
  /** Entry ids, next to start first. */
  dueToStart: string[];
  /** In expected arrival order at the next gate. */
  onStage: CarOnStage[];
  splitsByRun: Record<string, { splitIndex: number }[]>;
  entries: Carrier[];
  /** The stage's minimum time, for a combined start/finish gate. */
  minDurationMs: number;
}): Record<string, string> {
  const due: Candidate[] = input.dueToStart.map((entryId) => ({ entryId }));
  const running: Candidate[] = input.onStage;

  /**
   * A combined start/finish gate: a car on stage past the minimum stage time
   * is finishing (longest out first); within it, the car that just started;
   * with nobody on stage, the next car to start.
   */
  const combined = (at: number): Candidate[] => {
    const finishing = input.onStage
      .filter((car) => at - ms(car.startTime) >= input.minDurationMs)
      .sort((a, b) => ms(a.startTime) - ms(b.startTime));
    if (finishing.length > 0) return finishing;
    // Right after a car started here, it's that car breaking the beam again
    // (pulling away slowly from the line outlasts the gate's lockout), not the
    // next start: no suggestion, so a marshal dismisses it.
    const justStarted = input.onStage.some((car) => at >= ms(car.startTime));
    return justStarted ? [] : due;
  };

  const suggestions: Record<string, string> = {};
  const taken = new Set<string>();
  const byTime = [...input.passings].sort(
    (a, b) => ms(a.timestampGate) - ms(b.timestampGate),
  );
  for (const passing of byTime) {
    const gate = input.gates.find(
      (g) => g.active && g.gateId === passing.gateId,
    );
    if (!gate || gate.stageId !== input.stageId) continue;
    const candidates =
      gate.role === GateRole.STAGE_START
        ? due
        : gate.role === GateRole.STAGE_START_FINISH
          ? combined(ms(passing.timestampGate))
          : running;
    const carriers = carriersOf(input.entries, passing);
    const pick = candidates.find(
      (car) =>
        !taken.has(car.entryId) &&
        (!carriers || carriers.has(car.entryId)) &&
        (gate.role !== GateRole.STAGE_SPLIT ||
          !input.splitsByRun[car.runId ?? '']?.some(
            (s) => s.splitIndex === gate.splitIndex,
          )),
    );
    if (pick) {
      suggestions[passing.eventId] = pick.entryId;
      taken.add(pick.entryId);
    }
  }
  return suggestions;
}
