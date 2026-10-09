import { PenaltyScope, PenaltyTier } from '@rally-gate/shared';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** An entry in the rally's penalty catalogue ("Jump start"). */
@Entity()
export class PenaltyType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', default: PenaltyScope.STAGE })
  scope: PenaltyScope;

  @Column({ type: 'simple-json' })
  tiers: PenaltyTier[];
}
