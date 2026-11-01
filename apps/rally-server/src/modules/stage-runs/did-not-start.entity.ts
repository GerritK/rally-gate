import { Entity, PrimaryColumn } from 'typeorm';

/**
 * DNS on one stage. Not a `StageRun`: a run has a start time, and a DNS row
 * must stay out of the open-run index and `countingRuns`. Marked by a
 * marshal or written by `StagesService.close`; a run started for the car
 * deletes it.
 */
@Entity()
export class DidNotStart {
  @PrimaryColumn()
  entryId: string;

  @PrimaryColumn()
  stageId: string;
}
