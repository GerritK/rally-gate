import { PenaltyScope, PenaltyTier } from '@rally-gate/shared';
import { Penalty } from './penalty.entity';
import { PenaltyType } from './penalty-type.entity';

/** The price of the `n`th offence: the last tier starting at or before it. */
function tierSeconds(tiers: PenaltyTier[], n: number): number {
  return tiers.filter((tier) => tier.fromCount <= n).at(-1)?.seconds ?? 0;
}

/**
 * Each penalty's price in ms, by id. Offences of a type are counted per
 * entry in stage order (penalties on no stage after every stage, then by
 * entry time), from 1 again per stage unless the type counts per rally. So
 * every penalty of the rally goes in, even to price one.
 */
export function pricePenalties(
  penalties: Penalty[],
  types: PenaltyType[],
  stageOrder: string[],
): Map<string, number> {
  const typeById = new Map(types.map((type) => [type.id, type]));
  const position = (stageId: string | null) =>
    stageId === null ? Infinity : stageOrder.indexOf(stageId);
  const sorted = [...penalties].sort(
    (a, b) =>
      position(a.stageId) - position(b.stageId) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const counted = new Map<string, number>();
  const prices = new Map<string, number>();
  for (const penalty of sorted) {
    const type = penalty.typeId ? typeById.get(penalty.typeId) : undefined;
    if (!type) {
      prices.set(penalty.id, (penalty.seconds ?? 0) * penalty.count * 1000);
      continue;
    }
    const key = [
      penalty.entryId,
      type.id,
      type.scope === PenaltyScope.RALLY ? '' : (penalty.stageId ?? ''),
    ].join('|');
    const before = counted.get(key) ?? 0;
    let seconds = 0;
    for (let n = before + 1; n <= before + penalty.count; n++) {
      seconds += tierSeconds(type.tiers, n);
    }
    counted.set(key, before + penalty.count);
    prices.set(penalty.id, seconds * 1000);
  }
  return prices;
}
