<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  activateGateAssignment,
  API_BASE,
  closeStage,
  correctStageRun,
  createGateAssignment,
  createStageRun,
  deactivateGateAssignment,
  deleteGateAssignment,
  deleteStageRun,
  fetchGateAssignments,
  fetchGates,
  fetchNonFinishers,
  fetchOverallClassification,
  fetchRecentEvents,
  fetchSplitClassification,
  fetchSplitGatesForStage,
  fetchSplitsForRun,
  fetchStageClassification,
  fetchStageRuns,
  fetchStages,
  fetchVehicles,
  GATE_ROLES,
  type ClassificationEntry,
  type DetectionEventRecord,
  type Gate,
  type GateAssignment,
  type OverallClassificationEntry,
  type SplitClassificationEntry,
  type SplitGateInfo,
  type Stage,
  type StageOutcomeEntry,
  type StageRun,
  type StageSplit,
  type Vehicle,
} from './api';
import {
  formatClockTime,
  formatRelativeTime,
  formatStageDuration,
  openTimePicker,
} from '@rally-gate/ui';

const HEARTBEAT_ONLINE_THRESHOLD_MS = 30_000;

// Ticks every second so relative "Xs ago" heartbeat displays (and the
// online/offline chip) keep counting up without needing new gate data.
const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval>;

const detections = ref<DetectionEventRecord[]>([]);
const stageRuns = ref<StageRun[]>([]);
const stages = ref<Stage[]>([]);
const selectedStageId = ref<string>('');
const stageClassification = ref<ClassificationEntry[]>([]);
const overallClassification = ref<OverallClassificationEntry[]>([]);
const splitsByRun = ref<Record<string, StageSplit[]>>({});
const splitGates = ref<SplitGateInfo[]>([]);
const selectedSplitIndex = ref<number | null>(null);
const splitClassification = ref<SplitClassificationEntry[]>([]);
const nonFinishers = ref<StageOutcomeEntry[]>([]);
const closingStage = ref(false);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const vehicles = ref<Vehicle[]>([]);
const newAssignment = ref<{
  gateId: string;
  stageId: string;
  role: string;
  splitIndex?: number;
}>({
  gateId: '',
  stageId: '',
  role: GATE_ROLES[0],
});
const newRun = ref<{ vehicleId: string; stageId: string; startTime: string }>({
  vehicleId: '',
  stageId: '',
  startTime: '',
});
const editingRunId = ref<string | null>(null);

function toggleEditRun(runId: string) {
  editingRunId.value = editingRunId.value === runId ? null : runId;
}
let detectionsSource: EventSource;
let stageRunsSource: EventSource;
let stageRunSplitsSource: EventSource;

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

function formatDuration(ms?: number): string {
  return ms === undefined ? '-' : formatStageDuration(ms);
}

/** A STARTED run has no durationMs yet — tick it live off the `now` ref. */
function runDurationDisplay(run: StageRun): string {
  if (run.status === 'STARTED') {
    return formatStageDuration(now.value - new Date(run.startTime).getTime());
  }
  return formatDuration(run.durationMs);
}

function formatGap(ms: number): string {
  return ms === 0 ? '-' : `+${formatStageDuration(ms)}`;
}

async function refreshClassifications() {
  if (selectedStageId.value) {
    stageClassification.value = await fetchStageClassification(
      selectedStageId.value,
    );
  }
  overallClassification.value = await fetchOverallClassification();
}

async function refreshSplitClassification() {
  if (selectedStageId.value && selectedSplitIndex.value !== null) {
    splitClassification.value = await fetchSplitClassification(
      selectedStageId.value,
      selectedSplitIndex.value,
    );
  } else {
    splitClassification.value = [];
  }
}

async function refreshNonFinishers() {
  nonFinishers.value = selectedStageId.value
    ? await fetchNonFinishers(selectedStageId.value)
    : [];
}

async function onStageSelected() {
  await refreshClassifications();
  splitGates.value = selectedStageId.value
    ? await fetchSplitGatesForStage(selectedStageId.value)
    : [];
  selectedSplitIndex.value =
    splitGates.value.length > 0 ? splitGates.value[0].splitIndex! : null;
  await refreshSplitClassification();
  await refreshNonFinishers();
}

const selectedStage = computed(() =>
  stages.value.find((stage) => stage.id === selectedStageId.value),
);

const stageOptions = computed(() =>
  stages.value.map((s) => ({ id: s.id, title: `${s.stageNumber}. ${s.name}` })),
);

const splitGateOptions = computed(() =>
  splitGates.value.map((g) => ({
    value: g.splitIndex,
    title: `Split ${g.splitIndex} (${g.name})`,
  })),
);

const vehicleOptions = computed(() =>
  vehicles.value.map((v) => ({
    id: v.id,
    title: `#${v.startNumber} ${v.driverName}`,
  })),
);

function isOnline(gate: Gate): boolean {
  if (!gate.lastHeartbeatAt) return false;
  return (
    now.value - new Date(gate.lastHeartbeatAt).getTime() <
    HEARTBEAT_ONLINE_THRESHOLD_MS
  );
}

function stageName(stageId: string): string {
  return stages.value.find((stage) => stage.id === stageId)?.name ?? stageId;
}

function vehicleName(vehicleId: string): string {
  const vehicle = vehicles.value.find((v) => v.id === vehicleId);
  return vehicle ? `#${vehicle.startNumber} ${vehicle.driverName}` : vehicleId;
}

function runStatusColor(status: string): string {
  switch (status) {
    case 'FINISHED':
      return 'success';
    case 'STARTED':
      return 'info';
    case 'CANCELLED':
      return 'error';
    default:
      return 'timing-idle';
  }
}

function outcomeColor(outcome: string): string {
  return outcome === 'DNF' ? 'error' : 'warning';
}

function toLocalTimeValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * A correction only ever nudges the time of day (the marshal fixing a
 * missed/bad detection knows the exact second, not a different date) — the
 * date always comes from context (the run's existing date, or today for a
 * new run), never from the picker itself.
 */
function combineDateAndTime(
  dateSource: string | Date,
  timeValue: string,
): string {
  const d = new Date(dateSource);
  const [h, m, s] = timeValue.split(':').map(Number);
  d.setHours(h, m, s ?? 0, 0);
  return d.toISOString();
}

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

async function refreshGates() {
  gates.value = await fetchGates();
  gateAssignments.value = await fetchGateAssignments();
}

async function onCreateAssignment() {
  if (!newAssignment.value.gateId || !newAssignment.value.stageId) return;
  await createGateAssignment({ ...newAssignment.value });
  newAssignment.value = { gateId: '', stageId: '', role: GATE_ROLES[0] };
  await refreshGates();
}

async function onActivateAssignment(assignment: GateAssignment) {
  await activateGateAssignment(assignment.id);
  await refreshGates();
}

async function onDeactivateAssignment(assignment: GateAssignment) {
  await deactivateGateAssignment(assignment.id);
  await refreshGates();
}

async function onDeleteAssignment(assignment: GateAssignment) {
  await deleteGateAssignment(assignment.id);
  await refreshGates();
}

async function onCloseStage() {
  if (!selectedStageId.value || closingStage.value) return;
  closingStage.value = true;
  try {
    const updated = await closeStage(selectedStageId.value);
    const idx = stages.value.findIndex((stage) => stage.id === updated.id);
    if (idx !== -1) stages.value[idx] = updated;
    await refreshClassifications();
    await refreshNonFinishers();
  } finally {
    closingStage.value = false;
  }
}

watch(selectedStageId, onStageSelected);
watch(selectedSplitIndex, refreshSplitClassification);

onMounted(async () => {
  detections.value = await fetchRecentEvents();
  stageRuns.value = await fetchStageRuns();
  stages.value = await fetchStages();
  if (stages.value.length > 0) {
    selectedStageId.value = stages.value[0].id;
  }
  await onStageSelected();
  await refreshGates();
  vehicles.value = await fetchVehicles();

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
    refreshClassifications();
    refreshSplitClassification();
  };

  stageRunSplitsSource = new EventSource(`${API_BASE}/live/stage-run-splits`);
  stageRunSplitsSource.onmessage = (e) => {
    upsertSplit(JSON.parse(e.data));
    refreshSplitClassification();
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
  <v-app>
    <v-app-bar title="Rally Gate — Live Timing" color="primary" />
    <v-main>
      <v-container fluid class="py-6">
        <v-card class="mb-6">
          <v-card-title>Stage Classification</v-card-title>
          <v-card-text>
            <div class="d-flex flex-wrap align-center ga-4 mb-4">
              <v-select
                v-model="selectedStageId"
                :items="stageOptions"
                item-title="title"
                item-value="id"
                label="Stage"
                density="comfortable"
                hide-details
                style="max-width: 320px"
              />
              <v-btn
                v-if="selectedStage && selectedStage.status !== 'CLOSED'"
                :loading="closingStage"
                :disabled="closingStage"
                color="error"
                variant="outlined"
                prepend-icon="mdi-flag-checkered"
                @click="onCloseStage"
              >
                Close Stage (mark DNF/DNS)
              </v-btn>
              <v-chip v-else-if="selectedStage" color="timing-idle">
                Stage closed
              </v-chip>
            </div>

            <v-table density="comfortable">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>#</th>
                  <th>Driver</th>
                  <th>Co-Driver</th>
                  <th>Time</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in stageClassification" :key="entry.vehicleId">
                  <td>{{ entry.position }}</td>
                  <td>{{ entry.startNumber }}</td>
                  <td>{{ entry.driverName }}</td>
                  <td>{{ entry.coDriverName ?? '-' }}</td>
                  <td class="rg-timing">
                    {{ formatDuration(entry.durationMs) }}
                  </td>
                  <td class="rg-timing">{{ formatGap(entry.gapMs) }}</td>
                </tr>
              </tbody>
            </v-table>

            <v-table
              v-if="nonFinishers.length > 0"
              density="comfortable"
              class="mt-4"
            >
              <thead>
                <tr>
                  <th>#</th>
                  <th>Driver</th>
                  <th>Co-Driver</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in nonFinishers" :key="entry.vehicleId">
                  <td>{{ entry.startNumber }}</td>
                  <td>{{ entry.driverName }}</td>
                  <td>{{ entry.coDriverName ?? '-' }}</td>
                  <td>
                    <v-chip size="small" :color="outcomeColor(entry.outcome)">
                      {{ entry.outcome }}
                    </v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>

        <v-card class="mb-6">
          <v-card-title>Split Classification</v-card-title>
          <v-card-text>
            <v-select
              v-if="splitGates.length > 0"
              v-model="selectedSplitIndex"
              :items="splitGateOptions"
              item-title="title"
              item-value="value"
              label="Split"
              density="comfortable"
              hide-details
              style="max-width: 320px"
              class="mb-4"
            />
            <v-alert v-else type="info" variant="tonal" class="mb-4">
              No split gates configured for this stage.
            </v-alert>
            <v-table v-if="splitGates.length > 0" density="comfortable">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>#</th>
                  <th>Driver</th>
                  <th>Co-Driver</th>
                  <th>Time</th>
                  <th>Gap</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in splitClassification" :key="entry.vehicleId">
                  <td>{{ entry.position }}</td>
                  <td>{{ entry.startNumber }}</td>
                  <td>{{ entry.driverName }}</td>
                  <td>{{ entry.coDriverName ?? '-' }}</td>
                  <td class="rg-timing">
                    {{ formatDuration(entry.elapsedMs) }}
                  </td>
                  <td class="rg-timing">{{ formatGap(entry.gapMs) }}</td>
                  <td>
                    <v-chip
                      size="small"
                      :color="runStatusColor(entry.stageRunStatus)"
                    >
                      {{ entry.stageRunStatus }}
                    </v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>

        <v-card class="mb-6">
          <v-card-title>Overall Classification</v-card-title>
          <v-card-text>
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>#</th>
                  <th>Driver</th>
                  <th>Co-Driver</th>
                  <th>Total Time</th>
                  <th>Gap</th>
                  <th>Stages</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="entry in overallClassification"
                  :key="entry.vehicleId"
                >
                  <td>{{ entry.position }}</td>
                  <td>{{ entry.startNumber }}</td>
                  <td>{{ entry.driverName }}</td>
                  <td>{{ entry.coDriverName ?? '-' }}</td>
                  <td class="rg-timing">
                    {{ formatDuration(entry.durationMs) }}
                  </td>
                  <td class="rg-timing">{{ formatGap(entry.gapMs) }}</td>
                  <td>{{ entry.stagesCompleted }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>

        <v-card class="mb-6">
          <v-card-title>Stage Runs</v-card-title>
          <v-card-text>
            <v-alert type="info" variant="tonal" class="mb-4">
              Corrections apply immediately — use for missed or bad gate
              detections.
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
                  <td>{{ vehicleName(run.vehicleId) }}</td>
                  <td>{{ stageName(run.stageId) }}</td>
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
                        onCorrectStart(
                          run,
                          ($event.target as HTMLInputElement).value,
                        )
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
                      {{
                        run.finishTime ? formatClockTime(run.finishTime) : '-'
                      }}
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

        <v-card class="mb-6">
          <v-card-title>Gates</v-card-title>
          <v-card-text>
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Online</th>
                  <th>Last Heartbeat</th>
                  <th>Capabilities</th>
                  <th>Active Assignment</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="gate in gates" :key="gate.id">
                  <td>{{ gate.id }}</td>
                  <td>{{ gate.name }}</td>
                  <td>
                    <v-chip
                      size="small"
                      :color="isOnline(gate) ? 'success' : 'timing-idle'"
                    >
                      {{ isOnline(gate) ? 'online' : 'offline' }}
                    </v-chip>
                  </td>
                  <td
                    :title="
                      gate.lastHeartbeatAt
                        ? formatClockTime(gate.lastHeartbeatAt)
                        : undefined
                    "
                  >
                    {{
                      gate.lastHeartbeatAt
                        ? formatRelativeTime(gate.lastHeartbeatAt, now)
                        : 'never'
                    }}
                  </td>
                  <td>{{ gate.capabilities ?? '-' }}</td>
                  <td>
                    <v-chip
                      v-for="assignment in gateAssignments.filter(
                        (a) => a.gateId === gate.id && a.active,
                      )"
                      :key="assignment.id"
                      size="small"
                      class="mr-1"
                    >
                      {{ assignment.role }} @
                      {{ stageName(assignment.stageId) }}
                    </v-chip>
                  </td>
                </tr>
              </tbody>
            </v-table>
            <v-alert v-if="gates.length === 0" type="info" variant="tonal">
              No gates yet — waiting for a gate-agent heartbeat.
            </v-alert>
          </v-card-text>
        </v-card>

        <v-card class="mb-6">
          <v-card-title>Gate Assignments</v-card-title>
          <v-card-text>
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th>Gate</th>
                  <th>Stage</th>
                  <th>Role</th>
                  <th>Split #</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="assignment in gateAssignments" :key="assignment.id">
                  <td>{{ assignment.gateId }}</td>
                  <td>{{ stageName(assignment.stageId) }}</td>
                  <td>{{ assignment.role }}</td>
                  <td>{{ assignment.splitIndex ?? '-' }}</td>
                  <td>
                    <v-chip
                      size="small"
                      :color="assignment.active ? 'success' : 'timing-idle'"
                    >
                      {{ assignment.active ? 'active' : 'inactive' }}
                    </v-chip>
                  </td>
                  <td>
                    <v-btn
                      v-if="!assignment.active"
                      size="small"
                      variant="text"
                      color="success"
                      prepend-icon="mdi-play"
                      @click="onActivateAssignment(assignment)"
                    >
                      Activate
                    </v-btn>
                    <v-btn
                      v-else
                      size="small"
                      variant="text"
                      prepend-icon="mdi-pause"
                      @click="onDeactivateAssignment(assignment)"
                    >
                      Deactivate
                    </v-btn>
                    <v-btn
                      size="small"
                      variant="text"
                      color="error"
                      prepend-icon="mdi-delete"
                      @click="onDeleteAssignment(assignment)"
                    >
                      Delete
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
            <form
              class="d-flex flex-wrap align-center ga-3 mt-4"
              @submit.prevent="onCreateAssignment"
            >
              <v-select
                v-model="newAssignment.gateId"
                :items="gates"
                item-title="name"
                item-value="id"
                label="Gate"
                density="comfortable"
                hide-details
                style="min-width: 200px"
              />
              <v-select
                v-model="newAssignment.stageId"
                :items="stageOptions"
                item-title="title"
                item-value="id"
                label="Stage"
                density="comfortable"
                hide-details
                style="min-width: 200px"
              />
              <v-select
                v-model="newAssignment.role"
                :items="[...GATE_ROLES]"
                label="Role"
                density="comfortable"
                hide-details
                style="min-width: 200px"
              />
              <v-text-field
                v-if="newAssignment.role === 'stage_split'"
                v-model.number="newAssignment.splitIndex"
                type="number"
                min="0"
                label="Split #"
                density="comfortable"
                hide-details
                style="max-width: 140px"
              />
              <v-btn type="submit" color="primary" prepend-icon="mdi-plus">
                Add Assignment
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
                      event.vehicleId ? vehicleName(event.vehicleId) : 'unknown'
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
      </v-container>
    </v-main>
  </v-app>
</template>
