<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { API_BASE, ApiError } from '../api/client';
import {
  fetchPendingEvents,
  fetchRecentEvents,
  retryPendingEvents,
  type DetectionEventRecord,
} from '../api/events';
import {
  fetchGateAssignments,
  type GateAssignment,
} from '../api/gate-assignments';
import { fetchGates, type Gate } from '../api/gates';
import {
  activateStage,
  closeStage,
  fetchStages,
  type Stage,
} from '../api/stages';
import {
  correctStageRun,
  createStageRun,
  deleteStageRun,
  fetchSplitsForRun,
  fetchStageRuns,
  unvoidStageRun,
  voidStageRun,
  type StageRun,
  type StageSplit,
} from '../api/stage-runs';
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import {
  formatClockTime,
  formatStageDuration,
  openTimePicker,
} from '@rally-gate/ui';
import {
  combineDateAndTime,
  formatDuration,
  isOnline,
  runStatusColor,
  stageName,
  toLocalTimeValue,
  vehicleName,
} from '../format';

const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval>;

const pendingDetections = ref<DetectionEventRecord[]>([]);
const retryingPending = ref(false);

async function refreshPending() {
  pendingDetections.value = await fetchPendingEvents();
}

async function onRetryPending() {
  if (retryingPending.value) return;
  retryingPending.value = true;
  try {
    await retryPendingEvents();
    await refreshPending();
  } finally {
    retryingPending.value = false;
  }
}

const detections = ref<DetectionEventRecord[]>([]);
const stageRuns = ref<StageRun[]>([]);
const stages = ref<Stage[]>([]);
const vehicles = ref<Vehicle[]>([]);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const splitsByRun = ref<Record<string, StageSplit[]>>({});
const flashingGateIds = ref<Record<string, boolean>>({});
const selectedStageId = ref<string>('');
const closingStage = ref(false);
const activatingStage = ref(false);
const conflictDialog = ref(false);
const conflictingStageNames = ref<string[]>([]);
const editingRunId = ref<string | null>(null);
const newRun = ref<{ vehicleId: string; startTime: string }>({
  vehicleId: '',
  startTime: '',
});

let detectionsSource: EventSource;
let stageRunsSource: EventSource;
let stageRunSplitsSource: EventSource;
let gatesSource: EventSource;
let pendingSource: EventSource;

const FLASH_DURATION_MS = 600;

function flashGate(gateId: string) {
  flashingGateIds.value[gateId] = true;
  setTimeout(() => {
    flashingGateIds.value[gateId] = false;
  }, FLASH_DURATION_MS);
}

function upsertGateStatus(gate: Gate) {
  const idx = gates.value.findIndex((g) => g.id === gate.id);
  if (idx === -1) {
    gates.value.push(gate);
  } else {
    gates.value[idx] = gate;
  }
  flashGate(gate.id);
}

function toggleEditRun(runId: string) {
  editingRunId.value = editingRunId.value === runId ? null : runId;
}

function upsertStageRun(run: StageRun) {
  const idx = stageRuns.value.findIndex((r) => r.id === run.id);
  if (idx === -1) {
    stageRuns.value.unshift(run);
  } else {
    stageRuns.value[idx] = run;
  }
}

function upsertSplit(split: StageSplit) {
  const splits = splitsByRun.value[split.stageRunId] ?? [];
  const idx = splits.findIndex((s) => s.id === split.id);
  if (idx === -1) {
    splitsByRun.value[split.stageRunId] = [...splits, split].sort(
      (a, b) => a.splitIndex - b.splitIndex,
    );
  } else {
    splits[idx] = split;
    splitsByRun.value[split.stageRunId] = [...splits];
  }
}

function formatSplits(runId: string): string {
  const splits = splitsByRun.value[runId];
  if (!splits || splits.length === 0) return '-';
  return splits
    .map((s) => `S${s.splitIndex}: ${formatStageDuration(s.elapsedMs)}`)
    .join(', ');
}

/** A STARTED run has no durationMs yet — tick it live off the `now` ref. */
function runDurationDisplay(run: StageRun): string {
  if (run.status === 'STARTED') {
    return formatStageDuration(now.value - new Date(run.startTime).getTime());
  }
  return formatDuration(run.durationMs);
}

const selectedStage = computed(() =>
  stages.value.find((stage) => stage.id === selectedStageId.value),
);

const stageOptions = computed(() =>
  stages.value.map((s) => ({ id: s.id, title: `${s.stageNumber}. ${s.name}` })),
);

const selectedStageGateIds = computed(
  () =>
    new Set(
      gateAssignments.value
        .filter((a) => a.active && a.stageId === selectedStageId.value)
        .map((a) => a.gateId),
    ),
);

/** All gates assigned to the selected stage, active or not — lets a marshal
 * check gate status before activating, not just once it's live. */
const selectedStageGates = computed(() => {
  const gateIds = new Set(
    gateAssignments.value
      .filter((a) => a.stageId === selectedStageId.value)
      .map((a) => a.gateId),
  );
  return gates.value.filter((g) => gateIds.has(g.id));
});

const filteredStageRuns = computed(() =>
  stageRuns.value.filter((run) => run.stageId === selectedStageId.value),
);

const filteredDetections = computed(() =>
  detections.value.filter((event) =>
    selectedStageGateIds.value.has(event.gateId),
  ),
);

function stageTitle(stageId: string): string {
  const stage = stages.value.find((s) => s.id === stageId);
  return stage ? `${stage.stageNumber}. ${stage.name}` : stageId;
}

const vehicleOptions = computed(() =>
  vehicles.value.map((v) => ({
    id: v.id,
    title: `#${v.startNumber} ${v.driverName}`,
  })),
);

async function onCorrectStart(run: StageRun, value: string) {
  if (!value) return;
  upsertStageRun(
    await correctStageRun(run.id, {
      startTime: combineDateAndTime(run.startTime, value),
    }),
  );
}

async function onCorrectFinish(run: StageRun, value: string) {
  upsertStageRun(
    await correctStageRun(run.id, {
      finishTime: value
        ? combineDateAndTime(run.finishTime ?? run.startTime, value)
        : null,
    }),
  );
}

/**
 * Red flag. Keeps the attempt on record but drops it from the results and
 * frees the car, so the start gate opens the re-run itself next time it goes
 * through — no restart time to type in.
 */
async function onVoidRun(run: StageRun) {
  if (
    !confirm(
      `Void ${vehicleName(vehicles.value, run.vehicleId)}'s attempt ${run.attempt}?\n\n` +
        `It stays on record but stops counting, and the car can run this stage again — ` +
        `the start gate will time the new attempt automatically.`,
    )
  )
    return;
  upsertStageRun(await voidStageRun(run.id));
}

/**
 * Reverses a void.
 *
 * Two of the server's refusals are final and surfaced as-is — their messages
 * already name the fix. The third, "this would displace the attempt that
 * currently counts", is a real choice, so it comes back with
 * `displacedAttempt` and is re-sent with `force` once confirmed.
 */
async function onUnvoidRun(run: StageRun) {
  try {
    upsertStageRun(await unvoidStageRun(run.id));
  } catch (err) {
    // Narrowed into a local so the type survives into the branches below.
    const conflict = err instanceof ApiError && err.status === 409 ? err : null;
    const displacedAttempt = (
      conflict?.body as { displacedAttempt?: number } | null
    )?.displacedAttempt;
    if (!conflict || displacedAttempt === undefined) {
      alert(err instanceof Error ? err.message : 'Failed to restore run');
      return;
    }
    if (
      !confirm(
        `${conflict.message}.\n\nAttempt ${displacedAttempt} stays on record but stops counting. Continue?`,
      )
    )
      return;
    upsertStageRun(await unvoidStageRun(run.id, true));
  }
}

async function onDeleteRun(run: StageRun) {
  await deleteStageRun(run.id);
  stageRuns.value = stageRuns.value.filter((r) => r.id !== run.id);
  delete splitsByRun.value[run.id];
}

async function onCreateRun() {
  if (
    !newRun.value.vehicleId ||
    !selectedStageId.value ||
    !newRun.value.startTime
  )
    return;
  try {
    const created = await createStageRun({
      vehicleId: newRun.value.vehicleId,
      stageId: selectedStageId.value,
      startTime: combineDateAndTime(new Date(), newRun.value.startTime),
    });
    upsertStageRun(created);
    splitsByRun.value[created.id] = [];
    newRun.value = { vehicleId: '', startTime: '' };
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to add run');
  }
}

/**
 * Refetches every stage rather than patching just the one — a forced
 * activate can bump another stage's status back down too (see
 * `docs/architecture.md`), and rally stage counts are small enough that
 * refetching all of them is simpler than tracking which ones changed.
 */
async function refreshStages() {
  stages.value = await fetchStages();
  gateAssignments.value = await fetchGateAssignments();
}

async function onActivateStage(force = false) {
  if (!selectedStageId.value || activatingStage.value) return;
  activatingStage.value = true;
  try {
    await activateStage(selectedStageId.value, force);
    await refreshStages();
    conflictDialog.value = false;
  } catch (err) {
    const conflictingStageIds =
      err instanceof ApiError && err.status === 409
        ? (err.body as { conflictingStageIds?: string[] } | null)
            ?.conflictingStageIds
        : undefined;
    if (conflictingStageIds) {
      conflictingStageNames.value = conflictingStageIds.map(stageTitle);
      conflictDialog.value = true;
    } else {
      alert(err instanceof Error ? err.message : 'Failed to activate stage');
    }
  } finally {
    activatingStage.value = false;
  }
}

async function onCloseStage() {
  if (!selectedStageId.value || closingStage.value) return;
  closingStage.value = true;
  try {
    await closeStage(selectedStageId.value);
    await refreshStages();
  } finally {
    closingStage.value = false;
  }
}

onMounted(async () => {
  detections.value = await fetchRecentEvents();
  stageRuns.value = await fetchStageRuns();
  stages.value = await fetchStages();
  vehicles.value = await fetchVehicles();
  gateAssignments.value = await fetchGateAssignments();
  gates.value = await fetchGates();
  const openStage = stages.value.find((s) => s.status !== 'CLOSED');
  selectedStageId.value = (openStage ?? stages.value[0])?.id ?? '';

  for (const run of stageRuns.value) {
    splitsByRun.value[run.id] = await fetchSplitsForRun(run.id);
  }

  detectionsSource = new EventSource(`${API_BASE}/live/detections`);
  detectionsSource.onmessage = (e) => {
    const event: DetectionEventRecord = JSON.parse(e.data);
    detections.value.unshift(event);
    flashGate(event.gateId);
  };

  gatesSource = new EventSource(`${API_BASE}/live/gates`);
  gatesSource.onmessage = (e) => {
    upsertGateStatus(JSON.parse(e.data));
  };

  stageRunsSource = new EventSource(`${API_BASE}/live/stage-runs`);
  stageRunsSource.onmessage = (e) => {
    upsertStageRun(JSON.parse(e.data));
  };

  stageRunSplitsSource = new EventSource(`${API_BASE}/live/stage-run-splits`);
  stageRunSplitsSource.onmessage = (e) => {
    upsertSplit(JSON.parse(e.data));
  };

  pendingSource = new EventSource(`${API_BASE}/live/pending-detections`);
  // `onopen` fires on the first connect *and* on every automatic reconnect,
  // which is exactly when this client may have missed a change — so it
  // doubles as the initial load and the resync, with no timer either way.
  pendingSource.onopen = () => void refreshPending();
  pendingSource.onmessage = (e) => {
    pendingDetections.value = (
      JSON.parse(e.data) as { pending: DetectionEventRecord[] }
    ).pending;
  };

  nowTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  detectionsSource?.close();
  stageRunsSource?.close();
  stageRunSplitsSource?.close();
  gatesSource?.close();
  pendingSource?.close();
  clearInterval(nowTimer);
});
</script>

<template>
  <v-alert
    v-if="pendingDetections.length > 0"
    type="error"
    variant="tonal"
    class="mb-6"
    icon="mdi-alert-circle-outline"
  >
    <div class="d-flex flex-wrap align-center ga-4">
      <div>
        <strong>
          {{ pendingDetections.length }} detection{{
            pendingDetections.length === 1 ? '' : 's'
          }}
          recorded but not timed.
        </strong>
        These passings are stored, but the run they belong to was not updated —
        so a start or finish is missing from the results. The server keeps
        retrying; if the count doesn't clear, fix the run by hand below.
        <div class="text-caption mt-1">
          Gates affected:
          {{ [...new Set(pendingDetections.map((d) => d.gateId))].join(', ') }}
        </div>
      </div>
      <v-spacer />
      <v-btn
        :loading="retryingPending"
        variant="outlined"
        prepend-icon="mdi-refresh"
        @click="onRetryPending"
      >
        Retry now
      </v-btn>
    </div>
  </v-alert>

  <div class="d-flex flex-wrap justify-center ga-2 mb-6">
    <v-chip
      v-for="gate in selectedStageGates"
      :key="gate.id"
      :class="{ 'gate-flash': flashingGateIds[gate.id] }"
      :color="isOnline(gate, now) ? 'success' : 'error'"
      prepend-icon="mdi-access-point"
      size="small"
    >
      {{ gate.name }}
    </v-chip>
    <span v-if="selectedStageGates.length === 0" class="text-medium-emphasis">
      No gates assigned to this stage yet.
    </span>
  </div>

  <v-card class="mb-6">
    <v-card-title>Stage Runs</v-card-title>
    <v-card-text>
      <div class="d-flex flex-wrap align-center ga-4 mb-4">
        <v-select
          v-model="selectedStageId"
          :items="stageOptions"
          item-title="title"
          item-value="id"
          label="Current stage"
          density="comfortable"
          hide-details
          style="max-width: 320px"
        />
        <v-chip
          v-if="selectedStage"
          :color="selectedStage.status === 'ACTIVE' ? 'success' : 'timing-idle'"
        >
          {{ selectedStage.status }}
        </v-chip>
        <v-btn
          v-if="selectedStage && selectedStage.status === 'NOT_STARTED'"
          :loading="activatingStage"
          :disabled="activatingStage"
          color="success"
          variant="outlined"
          prepend-icon="mdi-play"
          @click="onActivateStage()"
        >
          Activate Stage
        </v-btn>
        <v-btn
          v-if="selectedStage && selectedStage.status === 'ACTIVE'"
          :loading="closingStage"
          :disabled="closingStage"
          color="error"
          variant="outlined"
          prepend-icon="mdi-flag-checkered"
          @click="onCloseStage"
        >
          Close Stage (deactivates gates, marks DNF/DNS)
        </v-btn>
      </div>

      <v-alert type="info" variant="tonal" class="mb-4">
        Corrections apply immediately — use for missed or bad gate detections.
      </v-alert>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Vehicle</th>
            <th>Stage</th>
            <th>Start</th>
            <th>Splits</th>
            <th>Finish</th>
            <th>Duration</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in filteredStageRuns" :key="run.id">
            <td>{{ vehicleName(vehicles, run.vehicleId) }}</td>
            <td>{{ stageName(stages, run.stageId) }}</td>
            <td>
              <v-text-field
                v-if="editingRunId === run.id"
                type="time"
                step="1"
                density="compact"
                hide-details
                append-inner-icon="mdi-clock-outline"
                :model-value="toLocalTimeValue(run.startTime)"
                @click:append-inner="openTimePicker"
                @change="
                  onCorrectStart(run, ($event.target as HTMLInputElement).value)
                "
              />
              <span v-else class="rg-timing">
                {{ formatClockTime(run.startTime) }}
              </span>
            </td>
            <td class="rg-timing">{{ formatSplits(run.id) }}</td>
            <td>
              <v-text-field
                v-if="editingRunId === run.id"
                type="time"
                step="1"
                density="compact"
                hide-details
                append-inner-icon="mdi-clock-outline"
                :model-value="toLocalTimeValue(run.finishTime)"
                @click:append-inner="openTimePicker"
                @change="
                  onCorrectFinish(
                    run,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <span v-else class="rg-timing">
                {{ run.finishTime ? formatClockTime(run.finishTime) : '-' }}
              </span>
            </td>
            <td class="rg-timing">
              {{ runDurationDisplay(run) }}
            </td>
            <td>
              <v-chip
                size="small"
                :color="runStatusColor(run.status)"
                :prepend-icon="
                  run.status === 'VOIDED' ? 'mdi-cancel' : undefined
                "
              >
                {{ run.status }}
              </v-chip>
              <span
                v-if="run.attempt > 1"
                class="text-caption text-medium-emphasis ml-1"
              >
                attempt {{ run.attempt }}
              </span>
            </td>
            <td>
              <v-btn
                size="small"
                variant="text"
                :prepend-icon="
                  editingRunId === run.id ? 'mdi-check' : 'mdi-pencil'
                "
                @click="toggleEditRun(run.id)"
              >
                {{ editingRunId === run.id ? 'Done' : 'Correct' }}
              </v-btn>
              <v-btn
                v-if="!run.voided"
                size="small"
                variant="text"
                prepend-icon="mdi-cancel"
                @click="onVoidRun(run)"
              >
                Void
              </v-btn>
              <v-btn
                v-else
                size="small"
                variant="text"
                prepend-icon="mdi-restore"
                @click="onUnvoidRun(run)"
              >
                Restore
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete"
                @click="onDeleteRun(run)"
              >
                Delete
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
      <form
        class="d-flex flex-wrap align-center ga-3 mt-4"
        @submit.prevent="onCreateRun"
      >
        <v-select
          v-model="newRun.vehicleId"
          :items="vehicleOptions"
          item-title="title"
          item-value="id"
          label="Vehicle"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-text-field
          v-model="newRun.startTime"
          type="time"
          step="1"
          label="Start time (today)"
          density="comfortable"
          hide-details
          append-inner-icon="mdi-clock-outline"
          style="min-width: 220px"
          @click:append-inner="openTimePicker"
        />
        <v-btn
          type="submit"
          color="primary"
          prepend-icon="mdi-plus"
          :disabled="!selectedStageId"
        >
          Add Missing Run to
          {{ selectedStageId ? stageTitle(selectedStageId) : 'stage' }}
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-card>
    <v-card-title>Live Detections</v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Gate</th>
            <th>Transponder</th>
            <th>Vehicle</th>
            <th>Gate Time</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in filteredDetections" :key="event.eventId">
            <td>{{ event.gateId }}</td>
            <td>{{ event.transponderId }}</td>
            <td>
              {{
                event.vehicleId
                  ? vehicleName(vehicles, event.vehicleId)
                  : 'unknown'
              }}
            </td>
            <td class="rg-timing">
              {{ formatClockTime(event.timestampGate) }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <v-dialog v-model="conflictDialog" max-width="480">
    <v-card>
      <v-card-title>Gates already active elsewhere</v-card-title>
      <v-card-text>
        This stage shares gates with the currently active
        {{ conflictingStageNames.length > 1 ? 'stages' : 'stage' }}:
        <strong>{{ conflictingStageNames.join(', ') }}</strong
        >. Activating anyway will close
        {{ conflictingStageNames.length > 1 ? 'those stages' : 'that stage' }}
        — any of its cars still on course will be marked DNF.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="conflictDialog = false">Cancel</v-btn>
        <v-btn
          color="success"
          :loading="activatingStage"
          @click="onActivateStage(true)"
        >
          Activate anyway
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gate-flash {
  animation: gate-flash-pulse 0.6s ease-out;
}

@keyframes gate-flash-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0.7);
  }
  100% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-primary), 0);
  }
}
</style>
