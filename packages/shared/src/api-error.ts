/**
 * Why rally-server refused a request. Each value is a message key
 * (`errors.<value>`) in `apps/web`, which shows that text instead of the
 * English `message` — that one is for logs, curl and the seed script.
 */
export enum ApiErrorCode {
  ENTRY_NOT_FOUND = 'entryNotFound',
  START_NUMBER_TAKEN = 'startNumberTaken',
  ENTRY_OUT_OF_EVENT = 'entryOutOfEvent',
  CLASS_NOT_FOUND = 'classNotFound',
  CLASS_EXISTS = 'classExists',
  STAGE_NOT_FOUND = 'stageNotFound',
  STAGE_EXISTS = 'stageExists',
  STAGE_NUMBER_TAKEN = 'stageNumberTaken',
  STAGE_STARTED_NO_EDIT = 'stageStartedNoEdit',
  STAGE_STARTED_NO_DELETE = 'stageStartedNoDelete',
  STAGE_NOT_STARTED = 'stageNotStarted',
  STAGE_CLOSED = 'stageClosed',
  /** `params.conflictingStageIds`: activating with `force` closes them. */
  OTHER_STAGE_ACTIVE = 'otherStageActive',
  START_ORDER_FROZEN = 'startOrderFrozen',
  COMBINED_GATE_CLASH = 'combinedGateClash',
  GATE_IN_STARTED_STAGE = 'gateInStartedStage',
  /** `params.assignmentCount`: deleting with `force` removes them too. */
  GATE_HAS_ASSIGNMENTS = 'gateHasAssignments',
  CLOSE_STAGE_BEFORE_POWER_OFF = 'closeStageBeforePowerOff',
  STAGE_RUN_NOT_FOUND = 'stageRunNotFound',
  FINISH_NOT_AFTER_START = 'finishNotAfterStart',
  INVALID_TIME = 'invalidTime',
  ATTEMPT_ALREADY_COUNTS = 'attemptAlreadyCounts',
  /** `params.blockingAttempt`: the attempt to void first. */
  OTHER_ATTEMPT_COUNTS = 'otherAttemptCounts',
  RUN_NOT_FINISHABLE = 'runNotFinishable',
  RUN_STARTS_IN_FUTURE = 'runStartsInFuture',
  PASSING_NOT_WAITING = 'passingNotWaiting',
  PASSING_NOT_TIMEABLE = 'passingNotTimeable',
  PENALTY_NOT_FOUND = 'penaltyNotFound',
  PENALTY_TYPE_NOT_FOUND = 'penaltyTypeNotFound',
  PENALTY_TYPE_EXISTS = 'penaltyTypeExists',
  PENALTY_TIERS_INVALID = 'penaltyTiersInvalid',
  TYPED_PENALTY_HAS_SECONDS = 'typedPenaltyHasSeconds',
  FREE_PENALTY_INCOMPLETE = 'freePenaltyIncomplete',
  EVENT_NAME_UNUSABLE = 'eventNameUnusable',
  EVENT_FILE_EXISTS = 'eventFileExists',
  EVENT_FILE_NOT_FOUND = 'eventFileNotFound',
  EVENT_FIXED_BY_CONFIG = 'eventFixedByConfig',
  CLOSE_STAGE_BEFORE_SWITCH = 'closeStageBeforeSwitch',
  KNOWN_HARDWARE_STANDALONE_ONLY = 'knownHardwareStandaloneOnly',
}

/**
 * The body of every refusal the server raises itself. Validation-pipe 400s
 * and 500s carry no `code`; they show their `message` as it is.
 */
export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Named values for the translated text, and data a page acts on. */
  params?: Record<string, unknown>;
}
