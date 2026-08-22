<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { StageStatus } from '@rally-gate/shared';
import {
  createStage,
  deleteStage,
  fetchStages,
  type Stage,
} from '../api/stages';

const stages = ref<Stage[]>([]);
const newStage = ref({ id: '', name: '', stageNumber: 1 });
const creating = ref(false);
const deletingId = ref<string | null>(null);

function nextStageNumber(): number {
  return Math.max(0, ...stages.value.map((s) => s.stageNumber)) + 1;
}

async function refresh() {
  stages.value = await fetchStages();
  newStage.value.stageNumber = nextStageNumber();
}

async function onDeleteStage(stage: Stage) {
  if (!confirm(`Delete stage ${stage.id}?`)) return;
  deletingId.value = stage.id;
  try {
    await deleteStage(stage.id);
    await refresh();
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to delete stage');
  } finally {
    deletingId.value = null;
  }
}

async function onCreateStage() {
  if (!newStage.value.id || !newStage.value.name || creating.value) return;
  creating.value = true;
  try {
    await createStage({
      id: newStage.value.id,
      name: newStage.value.name,
      stageNumber: newStage.value.stageNumber,
      status: StageStatus.NOT_STARTED,
    });
    newStage.value.id = '';
    newStage.value.name = '';
    await refresh();
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to create stage');
  } finally {
    creating.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title>Stages</v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>#</th>
            <th>ID</th>
            <th>Name</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="stage in stages" :key="stage.id">
            <td>{{ stage.stageNumber }}</td>
            <td>{{ stage.id }}</td>
            <td>{{ stage.name }}</td>
            <td>
              <v-chip
                size="small"
                :color="stage.status === 'CLOSED' ? 'timing-idle' : 'success'"
              >
                {{ stage.status }}
              </v-chip>
            </td>
            <td>
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                :to="`/setup/stages/${stage.id}`"
              >
                Edit / Gates
              </v-btn>
              <v-btn
                v-if="stage.status === 'NOT_STARTED'"
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete"
                :loading="deletingId === stage.id"
                @click="onDeleteStage(stage)"
              >
                Delete
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
      <form
        class="d-flex flex-wrap align-center ga-3 mt-4"
        @submit.prevent="onCreateStage"
      >
        <v-text-field
          v-model.number="newStage.stageNumber"
          type="number"
          min="1"
          label="Stage #"
          density="comfortable"
          hide-details
          style="max-width: 140px"
        />
        <v-text-field
          v-model="newStage.id"
          label="ID (e.g. SS2)"
          density="comfortable"
          hide-details
          style="max-width: 160px"
        />
        <v-text-field
          v-model="newStage.name"
          label="Name"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="creating"
          prepend-icon="mdi-plus"
        >
          Create Stage
        </v-btn>
      </form>
    </v-card-text>
  </v-card>
</template>
