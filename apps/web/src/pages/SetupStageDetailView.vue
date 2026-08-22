<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  activateGateAssignment,
  createGateAssignment,
  deactivateGateAssignment,
  deleteGateAssignment,
  fetchGateAssignments,
  fetchGates,
  fetchStage,
  GATE_ROLES,
  upsertStage,
  type Gate,
  type GateAssignment,
  type Stage,
} from '../api';

const props = defineProps<{ stageId: string }>();

const stage = ref<Stage | null>(null);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const savingStage = ref(false);
const newAssignment = ref<{
  gateId: string;
  role: (typeof GATE_ROLES)[number];
  splitIndex?: number;
}>({ gateId: '', role: GATE_ROLES[0] });

const assignmentsForStage = computed(() =>
  gateAssignments.value.filter((a) => a.stageId === props.stageId),
);

async function refreshAssignments() {
  gateAssignments.value = await fetchGateAssignments();
}

async function load() {
  stage.value = await fetchStage(props.stageId);
  gates.value = await fetchGates();
  await refreshAssignments();
}

async function onSaveStage() {
  if (!stage.value || savingStage.value) return;
  savingStage.value = true;
  try {
    stage.value = await upsertStage(stage.value.id, {
      name: stage.value.name,
      stageNumber: stage.value.stageNumber,
      status: stage.value.status,
    });
  } finally {
    savingStage.value = false;
  }
}

async function onCreateAssignment() {
  if (!newAssignment.value.gateId) return;
  await createGateAssignment({
    ...newAssignment.value,
    stageId: props.stageId,
  });
  newAssignment.value = { gateId: '', role: GATE_ROLES[0] };
  await refreshAssignments();
}

async function onActivateAssignment(assignment: GateAssignment) {
  await activateGateAssignment(assignment.id);
  await refreshAssignments();
}

async function onDeactivateAssignment(assignment: GateAssignment) {
  await deactivateGateAssignment(assignment.id);
  await refreshAssignments();
}

async function onDeleteAssignment(assignment: GateAssignment) {
  await deleteGateAssignment(assignment.id);
  await refreshAssignments();
}

watch(() => props.stageId, load);
onMounted(load);
</script>

<template>
  <v-btn
    variant="text"
    prepend-icon="mdi-arrow-left"
    to="/setup/stages"
    class="mb-4"
  >
    Back to Stages
  </v-btn>

  <v-card v-if="stage" class="mb-6">
    <v-card-title>Stage Details</v-card-title>
    <v-card-text>
      <form
        class="d-flex flex-wrap align-center ga-3"
        @submit.prevent="onSaveStage"
      >
        <v-text-field
          v-model="stage.name"
          label="Name"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-text-field
          v-model.number="stage.stageNumber"
          type="number"
          min="1"
          label="Stage #"
          density="comfortable"
          hide-details
          style="max-width: 140px"
        />
        <v-chip :color="stage.status === 'CLOSED' ? 'timing-idle' : 'success'">
          {{ stage.status }}
        </v-chip>
        <v-btn
          type="submit"
          color="primary"
          :loading="savingStage"
          prepend-icon="mdi-content-save"
        >
          Save
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-card>
    <v-card-title>Gate Assignments</v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Gate</th>
            <th>Role</th>
            <th>Split #</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="assignment in assignmentsForStage" :key="assignment.id">
            <td>{{ assignment.gateId }}</td>
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
</template>
