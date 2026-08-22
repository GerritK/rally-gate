<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchStages, upsertStage, type Stage } from '../api';

const stages = ref<Stage[]>([]);
const newStage = ref({ id: '', name: '', stageNumber: 1 });
const creating = ref(false);

async function refresh() {
  stages.value = await fetchStages();
}

async function onCreateStage() {
  if (!newStage.value.id || !newStage.value.name || creating.value) return;
  creating.value = true;
  try {
    await upsertStage(newStage.value.id, {
      name: newStage.value.name,
      stageNumber: newStage.value.stageNumber,
      status: 'NOT_STARTED',
    });
    newStage.value = { id: '', name: '', stageNumber: stages.value.length + 2 };
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
            </td>
          </tr>
        </tbody>
      </v-table>
      <form
        class="d-flex flex-wrap align-center ga-3 mt-4"
        @submit.prevent="onCreateStage"
      >
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
        <v-text-field
          v-model.number="newStage.stageNumber"
          type="number"
          min="1"
          label="Stage #"
          density="comfortable"
          hide-details
          style="max-width: 140px"
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
