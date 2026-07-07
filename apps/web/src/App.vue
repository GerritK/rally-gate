<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import {
  API_BASE,
  fetchOverallClassification,
  fetchRecentEvents,
  fetchSplitsForRun,
  fetchStageClassification,
  fetchStageRuns,
  fetchStages,
  type ClassificationEntry,
  type DetectionEventRecord,
  type OverallClassificationEntry,
  type Stage,
  type StageRun,
  type StageSplit,
} from './api';

const detections = ref<DetectionEventRecord[]>([]);
const stageRuns = ref<StageRun[]>([]);
const stages = ref<Stage[]>([]);
const selectedStageId = ref<string>('');
const stageClassification = ref<ClassificationEntry[]>([]);
const overallClassification = ref<OverallClassificationEntry[]>([]);
const splitsByRun = ref<Record<string, StageSplit[]>>({});
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
    splitsByRun.value[split.stageRunId] = [...splits, split].sort((a, b) => a.splitIndex - b.splitIndex);
  } else {
    splits[idx] = split;
    splitsByRun.value[split.stageRunId] = [...splits];
  }
}

function formatSplits(runId: string): string {
  const splits = splitsByRun.value[runId];
  if (!splits || splits.length === 0) return '-';
  return splits.map((s) => `S${s.splitIndex}: ${(s.elapsedMs / 1000).toFixed(3)}s`).join(', ');
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
    stageClassification.value = await fetchStageClassification(selectedStageId.value);
  }
  overallClassification.value = await fetchOverallClassification();
}

watch(selectedStageId, refreshClassifications);

onMounted(async () => {
  detections.value = await fetchRecentEvents();
  stageRuns.value = await fetchStageRuns();
  stages.value = await fetchStages();
  if (stages.value.length > 0) {
    selectedStageId.value = stages.value[0].id;
  }
  await refreshClassifications();

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
  };

  stageRunSplitsSource = new EventSource(`${API_BASE}/live/stage-run-splits`);
  stageRunSplitsSource.onmessage = (e) => {
    upsertSplit(JSON.parse(e.data));
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
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in stageRuns" :key="run.id">
            <td>{{ run.vehicleId }}</td>
            <td>{{ run.stageId }}</td>
            <td>{{ new Date(run.startTime).toLocaleTimeString() }}</td>
            <td>{{ formatSplits(run.id) }}</td>
            <td>{{ run.finishTime ? new Date(run.finishTime).toLocaleTimeString() : '-' }}</td>
            <td>{{ formatDuration(run.durationMs) }}</td>
            <td>{{ run.status }}</td>
          </tr>
        </tbody>
      </table>
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
th, td {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #ccc;
}
</style>
