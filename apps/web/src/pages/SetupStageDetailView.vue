<script setup lang="ts">
import { can } from '../api/auth';
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
import { fetchRallyInfo } from '../api/rally-info';
import {
  combineDateAndTime,
  gateRoleLabel,
  required,
  STAGE_STATUS_DISPLAY,
  stageScoringLabel,
} from '../format';
import {
  formatClockTime,
  formatStageDuration,
  notify,
  openTimePicker,
  parseStageDuration,
  t,
} from '@rally-gate/ui';
import {
  DEFAULT_MIN_STAGE_DURATION_MS,
  DEFAULT_SLOT_INTERVAL_MS,
  GateRole,
  StageScoring,
  StageStatus,
  StartMode,
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
const firstStartText = ref('');
/** Blank is the default. */
const intervalText = ref('');
const rallyDate = ref<string | undefined>();
const { markSaved } = useUnsavedChanges(() =>
  stage.value
    ? [
        stage.value.name,
        stage.value.stageNumber,
        stage.value.scoring,
        stage.value.startMode,
        expectedText.value,
        minText.value,
        firstStartText.value,
        intervalText.value,
      ]
    : null,
);
const assignmentDialogOpen = ref(false);
const newAssignment = ref<{
  gateId: string;
  role: GateRole;
  splitIndex?: number;
}>({ gateId: '', role: GateRole.STAGE_START });
const scoringOptions = computed(() =>
  Object.values(StageScoring).map((value) => ({
    value,
    title: stageScoringLabel(value),
  })),
);
// A timetable for unlimited runs means nothing: not on a shakedown.
const startModeOptions = computed(() => [
  { value: StartMode.GATE, title: t('startMode.gate') },
  ...(stage.value?.scoring === StageScoring.NONE
    ? []
    : [{ value: StartMode.SLOT_SCHEDULE, title: t('startMode.slotSchedule') }]),
  { value: StartMode.SLOT_MANUAL, title: t('startMode.slotManual') },
]);
const timetable = computed(
  () => stage.value?.startMode === StartMode.SLOT_SCHEDULE,
);
/** The posted list shows these times: unfreeze it to change them. */
const timetableLocked = computed(
  () => !stageEditable.value || !!stage.value?.startOrderFrozenAt,
);

/** Time only; the date is the first start's own, else the rally's, else today. */
function firstStartIso(): string | null {
  if (!firstStartText.value) return null;
  const date =
    stage.value?.firstStartTime ??
    (rallyDate.value ? `${rallyDate.value}T00:00` : new Date());
  return combineDateAndTime(date, firstStartText.value);
}
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

/** Tenths mean nothing in a timetable. */
const wholeSeconds = (ms: number | null) =>
  ms === null ? null : Math.round(ms / 1000) * 1000;

/** The server refuses less than a second. */
function intervalRule(value: string | null) {
  if (!value?.trim()) return true;
  const ms = wholeSeconds(parseStageDuration(value));
  return ms !== null && ms >= 1000 ? true : t('stage.intervalRule');
}

function showStage(loaded: Stage) {
  stage.value = loaded;
  expectedText.value = toText(loaded.expectedDurationMs);
  minText.value = toText(loaded.minDurationMs);
  firstStartText.value = formatClockTime(loaded.firstStartTime ?? undefined);
  intervalText.value = toText(loaded.slotIntervalMs);
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
    fetchRallyInfo().then((info) => (rallyDate.value = info?.date)),
  ]);
  showStage(loaded);
}

async function onSaveStage() {
  if (!stage.value || savingStage.value) return;
  if (durationRule(expectedText.value) !== true) return;
  if (durationRule(minText.value) !== true) return;
  if (intervalRule(intervalText.value) !== true) return;
  savingStage.value = true;
  try {
    showStage(
      await updateStage(stage.value.id, {
        name: stage.value.name,
        stageNumber: stage.value.stageNumber,
        scoring: stage.value.scoring,
        startMode: stage.value.startMode,
        expectedDurationMs: parseStageDuration(expectedText.value ?? ''),
        minDurationMs: parseStageDuration(minText.value ?? ''),
        firstStartTime: firstStartIso(),
        slotIntervalMs: wholeSeconds(
          parseStageDuration(intervalText.value ?? ''),
        ),
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

  <v-card v-if="stage" class="mb-4">
    <v-card-item>
      <v-card-title>{{ $t('stage.details') }}</v-card-title>
      <template #append>
        <StatusChip :display="STAGE_STATUS_DISPLAY[stage.status]" />
      </template>
    </v-card-item>
    <v-card-text>
      <v-alert v-if="!stageEditable" type="info" variant="tonal" class="mb-4">
        {{
          $t('stage.notEditable', {
            status: STAGE_STATUS_DISPLAY[stage.status].label,
          })
        }}
      </v-alert>
      <v-form
        :readonly="!can('setup')"
        class="rg-stage-form"
        @submit.prevent="onSaveStage"
      >
        <div class="rg-stage-sections">
          <div class="rg-stage-fields">
            <div class="rg-section-title">{{ $t('stage.general') }}</div>
            <div class="d-flex ga-3">
              <v-text-field
                v-model.number="stage.stageNumber"
                type="number"
                min="1"
                :label="$t('stages.number')"
                hide-details
                :disabled="!stageEditable"
                style="max-width: 110px"
              />
              <v-text-field
                v-model="stage.name"
                :label="$t('stages.name')"
                hide-details
                :disabled="!stageEditable"
              />
            </div>
          </div>
          <div class="rg-stage-fields">
            <div class="rg-section-title">{{ $t('stage.scoring') }}</div>
            <v-select
              v-model="stage.scoring"
              :items="scoringOptions"
              :label="$t('stage.scoring')"
              :hint="$t('stage.scoringHint')"
              persistent-hint
              :disabled="!stageEditable"
            />
          </div>
        </div>
        <div class="rg-stage-fields">
          <div class="rg-section-title">{{ $t('stage.times') }}</div>
          <div class="rg-stage-row">
            <v-select
              v-model="stage.startMode"
              :items="startModeOptions"
              :label="$t('stage.startMode')"
              :hint="$t(`startModeHint.${stage.startMode}`)"
              persistent-hint
              :disabled="!stageEditable"
            />
            <template v-if="timetable">
              <v-text-field
                v-model="firstStartText"
                type="time"
                step="1"
                :label="$t('stage.firstStart')"
                class="rg-timing"
                append-inner-icon="mdi-clock-outline"
                :hint="
                  stageEditable && stage.startOrderFrozenAt
                    ? $t('stage.timetableFrozen')
                    : ''
                "
                persistent-hint
                :rules="[required]"
                :disabled="timetableLocked"
                @click:append-inner="openTimePicker"
              />
              <v-text-field
                v-model="intervalText"
                :label="$t('stage.slotInterval')"
                :placeholder="formatStageDuration(DEFAULT_SLOT_INTERVAL_MS)"
                persistent-placeholder
                class="rg-timing"
                :rules="[intervalRule]"
                :disabled="timetableLocked"
              />
            </template>
            <v-text-field
              v-model="expectedText"
              :label="$t('stage.expectedTime')"
              :placeholder="formatStageDuration(300_000)"
              class="rg-timing"
              hide-details="auto"
              clearable
              :rules="[durationRule]"
              :disabled="!stageEditable"
            />
            <v-text-field
              v-model="minText"
              :label="$t('stage.minimumTime')"
              :placeholder="formatStageDuration(DEFAULT_MIN_STAGE_DURATION_MS)"
              persistent-placeholder
              :hint="$t('stage.minimumHint')"
              persistent-hint
              class="rg-timing"
              clearable
              :rules="[durationRule]"
              :disabled="!stageEditable"
            />
          </div>
        </div>
        <div>
          <v-btn
            v-if="can('setup')"
            type="submit"
            color="primary"
            :loading="savingStage"
            :disabled="!stageEditable"
            prepend-icon="mdi-content-save"
          >
            {{ $t('common.save') }}
          </v-btn>
        </div>
      </v-form>
    </v-card-text>
  </v-card>

  <v-card>
    <v-card-title class="d-flex align-center">
      {{ $t('stage.assignments') }}
      <v-spacer />
      <v-btn
        v-if="stageEditable && can('setup')"
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
              <v-menu v-if="stageEditable && can('setup')">
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

<style scoped>
.rg-stage-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* One column per topic, side by side as they fit; stacked on a phone. */
.rg-stage-sections {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px 32px;
  align-items: start;
}
/* Times: a row of their own, fields side by side as they fit. */
.rg-stage-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px 16px;
  align-items: start;
}
.rg-stage-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
