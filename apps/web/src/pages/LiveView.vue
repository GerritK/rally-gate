<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { API_BASE, ApiError } from '../api/client';
import { fetchRecentEvents, type DetectionEventRecord } from '../api/events';
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
  runStatusColor,
  stageName,
  toLocalTimeValue,
  vehicleName,
} from '../format';

const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval>;

const detections = ref<DetectionEventRecord[]>([]);
const stageRuns = ref<StageRun[]>([]);
const stages = ref<Stage[]>([]);
const vehicles = ref<Vehicle[]>([]);
const splitsByRun = ref<Record<string, StageSplit[]>>({});
const selectedStageId = ref<string>('');
const closingStage = ref(false);
const activatingStage = ref(false);
const conflictDialog = ref(false);
const conflictingStageNames = ref<string[]>([]);
const editingRunId = ref<string | null>(null);
const newRun = ref<{ vehicleId: string; stageId: string; startTime: string }>({
  vehicleId: '',
  stageId: '',
  startTime: '',
});

let detectionsSource: EventSource;
let stageRunsSource: EventSource;
let stageRunSplitsSource: EventSource;

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

async function onDeleteRun(run: StageRun) {
  await deleteStageRun(run.id);
  stageRuns.value = stageRuns.value.filter((r) => r.id !== run.id);
  delete splitsByRun.value[run.id];
}

async function onCreateRun() {
  if (
    !newRun.value.vehicleId ||
    !newRun.value.stageId ||
    !newRun.value.startTime
  )
    return;
  try {
    const created = await createStageRun({
      vehicleId: newRun.value.vehicleId,
      stageId: newRun.value.stageId,
      startTime: combineDateAndTime(new Date(), newRun.value.startTime),
    });
    upsertStageRun(created);
    splitsByRun.value[created.id] = [];
    newRun.value = { vehicleId: '', stageId: '', startTime: '' };
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
  const openStage = stages.value.find((s) => s.status !== 'CLOSED');
  selectedStageId.value = (openStage ?? stages.value[0])?.id ?? '';

  for (const run of stageRuns.value) {
    splitsByRun.value[run.id] = await fetchSplitsForRun(run.id);
  }

  detectionsSource = new EventSource(`${API_BASE}/live/detections`);
  detectionsSource.onmessage = (e) => {
    detections.value.unshift(JSON.parse(e.data));
  };

  stageRunsSource = new EventSource(`${API_BASE}/live/stage-runs`);
  stageRunsSource.onmessage = (e) => {
    upsertStageRun(JSON.parse(e.data));
  };

  stageRunSplitsSource = new EventSource(`${API_BASE}/live/stage-run-splits`);
  stageRunSplitsSource.onmessage = (e) => {
    upsertSplit(JSON.parse(e.data));
  };

  nowTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  detectionsSource?.close();
  stageRunsSource?.close();
  stageRunSplitsSource?.close();
  clearInterval(nowTimer);
});
</script>

<template>
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
          <tr v-for="run in stageRuns" :key="run.id">
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
              <v-chip size="small" :color="runStatusColor(run.status)">
                {{ run.status }}
              </v-chip>
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
        <v-select
          v-model="newRun.stageId"
          :items="stageOptions"
          item-title="title"
          item-value="id"
          label="Stage"
          density="comfortable"
          hide-details
          style="min-width: 200px"
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
        <v-btn type="submit" color="primary" prepend-icon="mdi-plus">
          Add Missing Run
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
          <tr v-for="event in detections" :key="event.eventId">
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
