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

const HEARTBEAT_ONLINE_THRESHOLD_MS = 30_000;

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
    .map((s) => `S${s.splitIndex}: ${(s.elapsedMs / 1000).toFixed(3)}s`)
    .join(', ');
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '-';
  return `${(ms / 1000).toFixed(3)}s`;
}

function formatGap(ms: number): string {
  if (ms === 0) return '-';
  return `+${(ms / 1000).toFixed(3)}s`;
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

function isOnline(gate: Gate): boolean {
  if (!gate.lastHeartbeatAt) return false;
  return (
    Date.now() - new Date(gate.lastHeartbeatAt).getTime() <
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

function toLocalInputValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function onCorrectStart(run: StageRun, value: string) {
  if (!value) return;
  upsertStageRun(
    await correctStageRun(run.id, { startTime: new Date(value).toISOString() }),
  );
}

async function onCorrectFinish(run: StageRun, value: string) {
  upsertStageRun(
    await correctStageRun(run.id, {
      finishTime: value ? new Date(value).toISOString() : null,
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
      startTime: new Date(newRun.value.startTime).toISOString(),
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
});

onUnmounted(() => {
  detectionsSource?.close();
  stageRunsSource?.close();
  stageRunSplitsSource?.close();
});
</script>

<template>
  <main>
    <h1>Rally Gate — Live Timing</h1>

    <section>
      <h2>Stage Classification</h2>
      <label>
        Stage:
        <select v-model="selectedStageId">
          <option v-for="stage in stages" :key="stage.id" :value="stage.id">
            {{ stage.stageNumber }}. {{ stage.name }}
          </option>
        </select>
      </label>
      <button
        v-if="selectedStage && selectedStage.status !== 'CLOSED'"
        :disabled="closingStage"
        @click="onCloseStage"
      >
        Close Stage (mark DNF/DNS)
      </button>
      <span v-else-if="selectedStage">Stage closed.</span>
      <table>
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
            <td>{{ formatDuration(entry.durationMs) }}</td>
            <td>{{ formatGap(entry.gapMs) }}</td>
          </tr>
        </tbody>
      </table>
      <table v-if="nonFinishers.length > 0">
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
            <td>{{ entry.outcome }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Split Classification</h2>
      <label v-if="splitGates.length > 0">
        Split:
        <select v-model="selectedSplitIndex">
          <option
            v-for="gate in splitGates"
            :key="gate.gateId"
            :value="gate.splitIndex"
          >
            Split {{ gate.splitIndex }} ({{ gate.name }})
          </option>
        </select>
      </label>
      <p v-else>No split gates configured for this stage.</p>
      <table v-if="splitGates.length > 0">
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
            <td>{{ formatDuration(entry.elapsedMs) }}</td>
            <td>{{ formatGap(entry.gapMs) }}</td>
            <td>{{ entry.stageRunStatus }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Overall Classification</h2>
      <table>
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
          <tr v-for="entry in overallClassification" :key="entry.vehicleId">
            <td>{{ entry.position }}</td>
            <td>{{ entry.startNumber }}</td>
            <td>{{ entry.driverName }}</td>
            <td>{{ entry.coDriverName ?? '-' }}</td>
            <td>{{ formatDuration(entry.durationMs) }}</td>
            <td>{{ formatGap(entry.gapMs) }}</td>
            <td>{{ entry.stagesCompleted }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Stage Runs</h2>
      <p>
        Corrections apply immediately — use for missed or bad gate detections.
      </p>
      <table>
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
              <input
                v-if="editingRunId === run.id"
                type="datetime-local"
                step="1"
                :value="toLocalInputValue(run.startTime)"
                @change="
                  onCorrectStart(run, ($event.target as HTMLInputElement).value)
                "
              />
              <template v-else>{{
                new Date(run.startTime).toLocaleTimeString()
              }}</template>
            </td>
            <td>{{ formatSplits(run.id) }}</td>
            <td>
              <input
                v-if="editingRunId === run.id"
                type="datetime-local"
                step="1"
                :value="toLocalInputValue(run.finishTime)"
                @change="
                  onCorrectFinish(
                    run,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <template v-else>{{
                run.finishTime
                  ? new Date(run.finishTime).toLocaleTimeString()
                  : '-'
              }}</template>
            </td>
            <td>{{ formatDuration(run.durationMs) }}</td>
            <td>{{ run.status }}</td>
            <td>
              <button @click="toggleEditRun(run.id)">
                {{ editingRunId === run.id ? 'Done' : 'Correct' }}
              </button>
              <button @click="onDeleteRun(run)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
      <form @submit.prevent="onCreateRun">
        <select v-model="newRun.vehicleId">
          <option value="" disabled>Vehicle</option>
          <option
            v-for="vehicle in vehicles"
            :key="vehicle.id"
            :value="vehicle.id"
          >
            #{{ vehicle.startNumber }} {{ vehicle.driverName }}
          </option>
        </select>
        <select v-model="newRun.stageId">
          <option value="" disabled>Stage</option>
          <option v-for="stage in stages" :key="stage.id" :value="stage.id">
            {{ stage.name }}
          </option>
        </select>
        <input v-model="newRun.startTime" type="datetime-local" step="1" />
        <button type="submit">Add Missing Run</button>
      </form>
    </section>

    <section>
      <h2>Gates</h2>
      <table>
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
            <td>{{ isOnline(gate) ? 'online' : 'offline' }}</td>
            <td>
              {{
                gate.lastHeartbeatAt
                  ? new Date(gate.lastHeartbeatAt).toLocaleTimeString()
                  : 'never'
              }}
            </td>
            <td>{{ gate.capabilities ?? '-' }}</td>
            <td>
              <template
                v-for="assignment in gateAssignments.filter(
                  (a) => a.gateId === gate.id && a.active,
                )"
                :key="assignment.id"
              >
                {{ assignment.role }} @ {{ stageName(assignment.stageId) }}
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="gates.length === 0">
        No gates yet — waiting for a gate-agent heartbeat.
      </p>
    </section>

    <section>
      <h2>Gate Assignments</h2>
      <table>
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
            <td>{{ assignment.active ? 'yes' : 'no' }}</td>
            <td>
              <button
                v-if="!assignment.active"
                @click="onActivateAssignment(assignment)"
              >
                Activate
              </button>
              <button v-else @click="onDeactivateAssignment(assignment)">
                Deactivate
              </button>
              <button @click="onDeleteAssignment(assignment)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
      <form @submit.prevent="onCreateAssignment">
        <select v-model="newAssignment.gateId">
          <option value="" disabled>Gate</option>
          <option v-for="gate in gates" :key="gate.id" :value="gate.id">
            {{ gate.name }}
          </option>
        </select>
        <select v-model="newAssignment.stageId">
          <option value="" disabled>Stage</option>
          <option v-for="stage in stages" :key="stage.id" :value="stage.id">
            {{ stage.name }}
          </option>
        </select>
        <select v-model="newAssignment.role">
          <option v-for="role in GATE_ROLES" :key="role" :value="role">
            {{ role }}
          </option>
        </select>
        <input
          v-if="newAssignment.role === 'stage_split'"
          v-model.number="newAssignment.splitIndex"
          type="number"
          min="0"
          placeholder="Split #"
        />
        <button type="submit">Add Assignment</button>
      </form>
    </section>

    <section>
      <h2>Live Detections</h2>
      <table>
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
            <td>{{ event.vehicleId ?? 'unknown' }}</td>
            <td>{{ new Date(event.timestampGate).toLocaleTimeString() }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
main {
  max-width: 960px;
  margin: 2rem auto;
  font-family: system-ui, sans-serif;
  padding: 0 1rem;
}
section {
  margin-top: 2rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #ccc;
}
</style>
