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
import { fetchStage, updateStage, type Stage } from '../api/stages';
import FormDialog from '../components/FormDialog.vue';
import StatusChip from '../components/StatusChip.vue';
import { gateRoleLabel, required, STAGE_STATUS_DISPLAY } from '../format';
import {
  formatStageDuration,
  notify,
  parseStageDuration,
  t,
} from '@rally-gate/ui';
import {
  DEFAULT_MIN_STAGE_DURATION_MS,
  GateRole,
  StageStatus,
} from '@rally-gate/shared';
import { useUnsavedChanges } from '../unsaved-changes';

const props = defineProps<{ stageId: string }>();

const stage = ref<Stage | null>(null);
const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const savingStage = ref(false);
/** Durations are typed like a stopwatch reading ("5:00", "0:10"), the same
 * as a corrected stage time; blank means none (expected) or the default
 * (minimum). */
const expectedText = ref('');
const minText = ref('');
const { markSaved } = useUnsavedChanges(() =>
  stage.value
    ? [
        stage.value.name,
        stage.value.stageNumber,
        expectedText.value,
        minText.value,
      ]
    : null,
);
const assignmentDialogOpen = ref(false);
const newAssignment = ref<{
  gateId: string;
  role: GateRole;
  splitIndex?: number;
}>({ gateId: '', role: GateRole.STAGE_START });
const roleOptions = computed(() =>
  GATE_ROLES.map((role) => ({
    value: role,
    title: gateRoleLabel({ role }).trim(),
  })),
);

function openAssignmentDialog() {
  newAssignment.value = { gateId: '', role: GateRole.STAGE_START };
  assignmentDialogOpen.value = true;
}

const assignmentsForStage = computed(() =>
  gateAssignments.value.filter((a) => a.stageId === props.stageId),
);

function toText(ms: number | null): string {
  return ms ? formatStageDuration(ms) : '';
}

function durationRule(value: string | null) {
  return !value?.trim() || parseStageDuration(value) !== null
    ? true
    : t('stage.durationRule');
}

function showStage(loaded: Stage) {
  stage.value = loaded;
  expectedText.value = toText(loaded.expectedDurationMs);
  minText.value = toText(loaded.minDurationMs);
  markSaved();
}

const stageEditable = computed(
  () => stage.value?.status === StageStatus.NOT_STARTED,
);

async function refreshAssignments() {
  gateAssignments.value = await fetchGateAssignments();
}

async function load() {
  const [loaded] = await Promise.all([
    fetchStage(props.stageId),
    fetchGates().then((g) => (gates.value = g)),
    refreshAssignments(),
  ]);
  showStage(loaded);
}

async function onSaveStage() {
  if (!stage.value || savingStage.value) return;
  if (durationRule(expectedText.value) !== true) return;
  if (durationRule(minText.value) !== true) return;
  savingStage.value = true;
  try {
    showStage(
      await updateStage(stage.value.id, {
        name: stage.value.name,
        stageNumber: stage.value.stageNumber,
        expectedDurationMs: parseStageDuration(expectedText.value ?? ''),
        minDurationMs: parseStageDuration(minText.value ?? ''),
      }),
    );
    notify(t('stage.saved'));
  } finally {
    savingStage.value = false;
  }
}

async function onCreateAssignment() {
  const { splitIndex, ...rest } = newAssignment.value;
  await createGateAssignment({
    ...rest,
    ...(rest.role === GateRole.STAGE_SPLIT ? { splitIndex } : {}),
    stageId: props.stageId,
  });
  await refreshAssignments();
}

/** No confirmation: a plan edit on a stage that hasn't started, cheap to redo. */
async function onDeleteAssignment(assignment: GateAssignment) {
  await deleteGateAssignment(assignment.id);
  await refreshAssignments();
  notify(t('stage.assignmentDeleted'));
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
    {{ $t('stage.back') }}
  </v-btn>

  <v-card v-if="stage" class="mb-6">
    <v-card-title>{{ $t('stage.details') }}</v-card-title>
    <v-card-text>
      <v-alert v-if="!stageEditable" type="info" variant="tonal" class="mb-4">
        {{
          $t('stage.notEditable', {
            status: STAGE_STATUS_DISPLAY[stage.status].label,
          })
        }}
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3"
        @submit.prevent="onSaveStage"
      >
        <v-text-field
          v-model.number="stage.stageNumber"
          type="number"
          min="1"
          :label="$t('stages.number')"
          density="comfortable"
          hide-details
          :disabled="!stageEditable"
          style="max-width: 140px"
        />
        <v-text-field
          v-model="stage.name"
          :label="$t('stages.name')"
          density="comfortable"
          hide-details
          :disabled="!stageEditable"
          style="min-width: 220px"
        />
        <v-text-field
          v-model="expectedText"
          :label="$t('stage.expectedTime')"
          placeholder="5:00"
          class="rg-timing"
          density="comfortable"
          hide-details="auto"
          clearable
          :rules="[durationRule]"
          :disabled="!stageEditable"
          style="max-width: 200px"
        />
        <v-text-field
          v-model="minText"
          :label="$t('stage.minimumTime')"
          :placeholder="formatStageDuration(DEFAULT_MIN_STAGE_DURATION_MS)"
          persistent-placeholder
          class="rg-timing"
          density="comfortable"
          hide-details="auto"
          clearable
          :rules="[durationRule]"
          :disabled="!stageEditable"
          style="max-width: 200px"
        />
        <StatusChip :display="STAGE_STATUS_DISPLAY[stage.status]" />
        <v-btn
          type="submit"
          color="primary"
          :loading="savingStage"
          :disabled="!stageEditable"
          prepend-icon="mdi-content-save"
        >
          {{ $t('common.save') }}
        </v-btn>
      </form>
      <div class="text-caption text-medium-emphasis mt-2">
        {{ $t('stage.minimumHint') }}
      </div>
    </v-card-text>
  </v-card>

  <v-card>
    <v-card-title class="d-flex align-center">
      {{ $t('stage.assignments') }}
      <v-spacer />
      <v-btn
        v-if="stageEditable"
        variant="tonal"
        prepend-icon="mdi-plus"
        @click="openAssignmentDialog"
      >
        {{ $t('stage.addAssignment') }}
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-alert
        v-if="stage && !stageEditable"
        type="info"
        variant="tonal"
        class="mb-4"
      >
        {{
          $t('stage.assignmentsLocked', {
            status: STAGE_STATUS_DISPLAY[stage.status].label,
          })
        }}
      </v-alert>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('stage.gate') }}</th>
            <th>{{ $t('stage.role') }}</th>
            <th>{{ $t('stage.active') }}</th>
            <th width="1%"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="assignment in assignmentsForStage" :key="assignment.id">
            <td>{{ assignment.gateId }}</td>
            <td>{{ gateRoleLabel(assignment) }}</td>
            <td>
              <v-chip
                size="small"
                :color="assignment.active ? 'success' : 'timing-idle'"
              >
                {{
                  assignment.active
                    ? $t('stage.isActive')
                    : $t('stage.isInactive')
                }}
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
                    :aria-label="
                      $t('common.moreFor', { name: assignment.gateId })
                    "
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    :title="$t('common.delete')"
                    base-color="error"
                    @click="onDeleteAssignment(assignment)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr v-if="assignmentsForStage.length === 0">
            <td colspan="4" class="rg-empty">
              {{
                stageEditable
                  ? $t('stage.noAssignmentsAdd', {
                      action: $t('stage.addAssignment'),
                    })
                  : $t('stage.noAssignments')
              }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="assignmentDialogOpen"
    :title="$t('stage.addAssignment')"
    :form="newAssignment"
    :save="onCreateAssignment"
    :saved="$t('stage.assignmentAdded')"
    :save-text="$t('stage.addAssignment')"
  >
    <v-select
      v-model="newAssignment.gateId"
      :items="gates"
      item-title="name"
      item-value="id"
      :label="$t('stage.gate')"
      :rules="[required]"
    />
    <v-select
      v-model="newAssignment.role"
      :items="roleOptions"
      :label="$t('stage.role')"
    />
    <v-text-field
      v-if="newAssignment.role === GateRole.STAGE_SPLIT"
      v-model.number="newAssignment.splitIndex"
      type="number"
      min="0"
      :label="$t('stage.splitNumber')"
      :rules="[required]"
    />
  </FormDialog>
</template>
