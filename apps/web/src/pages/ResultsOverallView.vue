<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  fetchOverallClassification,
  type OverallClassificationEntry,
} from '../api/classification';
import { fetchStages, type Stage } from '../api/stages';
import { formatDuration, formatGap } from '../format';

const router = useRouter();
const overallClassification = ref<OverallClassificationEntry[]>([]);
const stages = ref<Stage[]>([]);

/** Stages counted toward the overall — every closed stage that anyone
 * finished. A crew below this has notional time inside its total. */
const stagesCounted = computed(() =>
  Math.max(0, ...overallClassification.value.map((e) => e.stagesCompleted)),
);

const stageOptions = computed(() =>
  stages.value.map((s) => ({ id: s.id, title: `${s.stageNumber}. ${s.name}` })),
);

function goToStage(stageId: string) {
  router.push(`/results/stages/${stageId}`);
}

onMounted(async () => {
  overallClassification.value = await fetchOverallClassification();
  stages.value = await fetchStages();
});
</script>

<template>
  <v-select
    v-if="stageOptions.length > 0"
    :items="stageOptions"
    item-title="title"
    item-value="id"
    label="View a stage's results"
    density="comfortable"
    hide-details
    style="max-width: 320px"
    class="mb-6"
    @update:model-value="goToStage"
  />

  <v-card>
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
          <tr v-for="entry in overallClassification" :key="entry.vehicleId">
            <td>{{ entry.position }}</td>
            <td>{{ entry.startNumber }}</td>
            <td>{{ entry.driverName }}</td>
            <td>{{ entry.coDriverName ?? '-' }}</td>
            <td class="rg-timing">{{ formatDuration(entry.durationMs) }}</td>
            <td class="rg-timing">{{ formatGap(entry.gapMs) }}</td>
            <td>
              <v-tooltip
                v-if="entry.stagesCompleted < stagesCounted"
                :text="`Did not complete ${stagesCounted - entry.stagesCompleted} of ${stagesCounted} stages — a notional time is included in this total.`"
                location="top"
              >
                <template #activator="{ props }">
                  <span v-bind="props" class="text-warning">
                    {{ entry.stagesCompleted }}
                    <v-icon size="x-small" icon="mdi-asterisk" />
                  </span>
                </template>
              </v-tooltip>
              <span v-else>{{ entry.stagesCompleted }}</span>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>
