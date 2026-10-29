import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** One browser that redeemed an invitation or logged in with the password. */
@Entity()
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null: an organiser login with the password, not an invitation. */
  @Column({ type: 'varchar', nullable: true })
  invitationId: string | null;

  /** Counts within its invitation (or the password logins), from 1. */
  @Column({ type: 'int' })
  number: number;

  /** SHA-256 of the cookie, so a copied event file logs nobody in. */
  @Column({ type: 'varchar', unique: true })
  tokenHash: string;

  @Column({ type: 'boolean', default: false })
  blocked: boolean;

  @Column({ type: Date })
  createdAt: Date;
}
