import { PenaltyScope } from '@rally-gate/shared';
import { pricePenalties } from './penalty-pricing';
import { Penalty } from './penalty.entity';
import { PenaltyType } from './penalty-type.entity';

/** 1st 0:10, from the 2nd 0:30, from the 5th 1:00 each. */
const jumpStart = (scope: PenaltyScope): PenaltyType => ({
  id: 'jump',
  name: 'Jump start',
  scope,
  tiers: [
    { fromCount: 1, seconds: 10 },
    { fromCount: 2, seconds: 30 },
    { fromCount: 5, seconds: 60 },
  ],
});

let created = 0;
function penalty(fields: Partial<Penalty>): Penalty {
  created += 1;
  return {
    id: `p${created}`,
    entryId: 'v1',
    stageId: 'WP1',
    typeId: 'jump',
    count: 1,
    seconds: null,
    note: null,
    createdAt: new Date(created),
    ...fields,
  };
}

const total = (prices: Map<string, number>) =>
  [...prices.values()].reduce((sum, ms) => sum + ms, 0);

describe('pricePenalties', () => {
  it('prices tiers by how many offences came before', () => {
    const three = pricePenalties(
      [penalty({ count: 3 })],
      [jumpStart(PenaltyScope.STAGE)],
      ['WP1'],
    );
    const five = pricePenalties(
      [penalty({ count: 5 })],
      [jumpStart(PenaltyScope.STAGE)],
      ['WP1'],
    );

    expect(total(three)).toBe(70_000); // 0:10 + 0:30 + 0:30
    expect(total(five)).toBe(160_000); // + 0:30 + 1:00
  });

  it('counts from 1 again on every stage, unless the type counts per rally', () => {
    const penalties = [
      penalty({ stageId: 'WP1' }),
      penalty({ stageId: 'WP2' }),
    ];

    const perStage = pricePenalties(
      penalties,
      [jumpStart(PenaltyScope.STAGE)],
      ['WP1', 'WP2'],
    );
    const perRally = pricePenalties(
      penalties,
      [jumpStart(PenaltyScope.RALLY)],
      ['WP1', 'WP2'],
    );

    expect([...perStage.values()]).toEqual([10_000, 10_000]);
    expect([...perRally.values()]).toEqual([10_000, 30_000]);
  });

  it('counts in stage order, not entry order, so a late entry reprices later stages', () => {
    const onWp2 = penalty({ stageId: 'WP2' });
    const onWp1 = penalty({ stageId: 'WP1' }); // entered afterwards

    const prices = pricePenalties(
      [onWp2, onWp1],
      [jumpStart(PenaltyScope.RALLY)],
      ['WP1', 'WP2'],
    );

    expect(prices.get(onWp1.id)).toBe(10_000);
    expect(prices.get(onWp2.id)).toBe(30_000);
  });

  it('counts penalties on no stage after every stage', () => {
    const rallyWide = penalty({ stageId: null });
    const onWp2 = penalty({ stageId: 'WP2' });

    const prices = pricePenalties(
      [rallyWide, onWp2],
      [jumpStart(PenaltyScope.RALLY)],
      ['WP1', 'WP2'],
    );

    expect(prices.get(onWp2.id)).toBe(10_000);
    expect(prices.get(rallyWide.id)).toBe(30_000);
  });

  it('counts each entry on its own', () => {
    const prices = pricePenalties(
      [penalty({ entryId: 'v1' }), penalty({ entryId: 'v2' })],
      [jumpStart(PenaltyScope.RALLY)],
      ['WP1'],
    );

    expect([...prices.values()]).toEqual([10_000, 10_000]);
  });

  it('prices a free-text penalty by its seconds', () => {
    const prices = pricePenalties(
      [penalty({ typeId: null, seconds: 45, note: 'Jury' })],
      [],
      ['WP1'],
    );

    expect(total(prices)).toBe(45_000);
  });
});
