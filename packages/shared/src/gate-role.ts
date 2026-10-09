/** Only roles the rule engine (`EventsService.applyRules`) acts on: a role
 *  it ignores would be a gate assigned in the plan that silently times
 *  nothing. Add one together with its rule. */
export enum GateRole {
  STAGE_START = 'stage_start',
  STAGE_SPLIT = 'stage_split',
  STAGE_FINISH = 'stage_finish',
  /** One gate as both: a passing finishes the car's open run, else starts one. */
  STAGE_START_FINISH = 'stage_start_finish',
}
