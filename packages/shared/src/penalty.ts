/**
 * Where a penalty type's offences are counted for its tiers: from 1 again on
 * every stage, or on through the whole rally (the 5th jump start of the day).
 */
export enum PenaltyScope {
  STAGE = 'STAGE',
  RALLY = 'RALLY',
}

/**
 * From the `fromCount`th offence on, each one costs `seconds`. A type's tiers
 * start at 1 and ascend; a single tier is a flat price per offence.
 */
export interface PenaltyTier {
  fromCount: number;
  seconds: number;
}
