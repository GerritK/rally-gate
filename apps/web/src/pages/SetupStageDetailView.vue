<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  createGateAssignment,
  deleteGateAssignment,
  fetchGateAssignments,
  GATE_ROLES,
  type GateAssignment,
} from '../api/gate-assignments';
import { fetchGates, type Gate } from '../api/gates';
import { fetchStage, upsertStage, type Stage } from '../api/stages';
import FormDialog from '../components/FormDialog.vue';
import { required, STAGE_STATUS_DISPLAY } from '../format';
import { notify } from '@rally-gate/ui';
import { useUnsavedChanges } from '../unsaved-changes';

const props = defineProps<{ stageId: string }>();

const stage = ref<Stage | null>(null);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const savingStage = ref(false);
const { markSaved } = useUnsavedChanges(() =>
  stage.value
    ? [
        stage.value.name,
        stage.value.stageNumber,
        stage.value.expectedDurationMs,
      ]
    : null,
);
const assignmentDialogOpen = ref(false);
const newAssignment = ref<{
  gateId: string;
  role: (typeof GATE_ROLES)[number];
  splitIndex?: number;
}>({ gateId: '', role: GATE_ROLES[0] });

function openAssignmentDialog() {
  newAssignment.value = { gateId: '', role: GATE_ROLES[0] };
  assignmentDialogOpen.value = true;
}

const assignmentsForStage = computed(() =>
  gateAssignments.value.filter((a) => a.stageId === props.stageId),
);

/** Entered in minutes, stored in ms; blank means no expectation. */
const expectedMinutes = computed({
  get: () =>
    stage.value?.expectedDurationMs
      ? stage.value.expectedDurationMs / 60_000
      : '',
  set: (value: number | string | null) => {
    if (!stage.value) return;
    stage.value.expectedDurationMs =
      !value || Number(value) <= 0 ? null : Math.round(Number(value) * 60_000);
  },
});

const stageEditable = computed(() => stage.value?.status === 'NOT_STARTED');

async function refreshAssignments() {
  gateAssignments.value = await fetchGateAssignments();
}

async function load() {
  stage.value = await fetchStage(props.stageId);
  markSaved();
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
      expectedDurationMs: stage.value.expectedDurationMs,
    });
    markSaved();
    notify('Stage saved');
  } finally {
    savingStage.value = false;
  }
}

async function onCreateAssignment() {
  const { splitIndex, ...rest } = newAssignment.value;
  await createGateAssignment({
    ...rest,
    ...(rest.role === 'stage_split' ? { splitIndex } : {}),
    stageId: props.stageId,
  });
  await refreshAssignments();
}

/** No confirmation: a plan edit on a stage that hasn't started, cheap to redo. */
async function onDeleteAssignment(assignment: GateAssignment) {
  await deleteGateAssignment(assignment.id);
  await refreshAssignments();
  notify('Assignment deleted');
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
      <v-alert v-if="!stageEditable" type="info" variant="tonal" class="mb-4">
        This stage is {{ stage.status }} and can only be edited while
        NOT_STARTED.
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3"
        @submit.prevent="onSaveStage"
      >
        <v-text-field
          v-model.number="stage.stageNumber"
          type="number"
          min="1"
          label="Stage #"
          density="comfortable"
          hide-details
          :disabled="!stageEditable"
          style="max-width: 140px"
        />
        <v-text-field
          v-model="stage.name"
          label="Name"
          density="comfortable"
          hide-details
          :disabled="!stageEditable"
          style="min-width: 220px"
        />
        <v-text-field
          v-model="expectedMinutes"
          type="number"
          min="0"
          step="0.5"
          label="Expected time (min)"
          density="comfortable"
          hide-details
          clearable
          :disabled="!stageEditable"
          style="max-width: 200px"
        />
        <v-chip
          :color="STAGE_STATUS_DISPLAY[stage.status].color"
          :prepend-icon="STAGE_STATUS_DISPLAY[stage.status].icon"
        >
          {{ STAGE_STATUS_DISPLAY[stage.status].label }}
        </v-chip>
        <v-btn
          type="submit"
          color="primary"
          :loading="savingStage"
          :disabled="!stageEditable"
          prepend-icon="mdi-content-save"
        >
          Save
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-card>
    <v-card-title class="d-flex align-center">
      Gate Assignments
      <v-spacer />
      <v-btn
        v-if="stageEditable"
        variant="tonal"
        prepend-icon="mdi-plus"
        @click="openAssignmentDialog"
      >
        Add Assignment
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-alert
        v-if="stage && !stageEditable"
        type="info"
        variant="tonal"
        class="mb-4"
      >
        This stage is {{ stage.status }} — gate assignments can only be added or
        removed while NOT_STARTED.
      </v-alert>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Gate</th>
            <th>Role</th>
            <th>Split #</th>
            <th>Active</th>
            <th width="1%"></th>
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
            <td class="text-no-wrap">
              <v-menu v-if="stageEditable">
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    size="small"
                    variant="text"
                    :aria-label="`More for ${assignment.gateId}`"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    title="Delete"
                    base-color="error"
                    @click="onDeleteAssignment(assignment)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr v-if="assignmentsForStage.length === 0">
            <td colspan="5" class="rg-empty">
              No gates assigned yet.{{
                stageEditable ? ' Add one with + Add Assignment.' : ''
              }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="assignmentDialogOpen"
    title="Add assignment"
    :form="newAssignment"
    :save="onCreateAssignment"
    saved="Assignment added"
    save-text="Add assignment"
  >
    <v-select
      v-model="newAssignment.gateId"
      :items="gates"
      item-title="name"
      item-value="id"
      label="Gate"
      :rules="[required]"
    />
    <v-select
      v-model="newAssignment.role"
      :items="[...GATE_ROLES]"
      label="Role"
    />
    <v-text-field
      v-if="newAssignment.role === 'stage_split'"
      v-model.number="newAssignment.splitIndex"
      type="number"
      min="0"
      label="Split #"
      :rules="[required]"
    />
  </FormDialog>
</template>
