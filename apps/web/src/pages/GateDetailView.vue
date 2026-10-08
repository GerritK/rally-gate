<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { formatClockTime, formatRelativeTime } from '@rally-gate/ui';
import { fetchRecentEvents, type DetectionEventRecord } from '../api/events';
import {
  fetchGateAssignments,
  type GateAssignment,
} from '../api/gate-assignments';
import { fetchGate, upsertGate, type Gate } from '../api/gates';
import { closeLiveStream, openLiveStream, upsert } from '../api/live';
import { fetchClockCorrectionThresholdMs } from '../api/settings';
import { fetchStages, type Stage } from '../api/stages';
import { fetchEntries, type Entry } from '../api/entries';
import { serverNow } from '../api/time';
import FormDialog from '../components/FormDialog.vue';
import GateClockChips from '../components/GateClockChips.vue';
import GateOnlineChip from '../components/GateOnlineChip.vue';
import GateVersion from '../components/GateVersion.vue';
import StatusChip from '../components/StatusChip.vue';
import {
  formatClockOffset,
  gateRoleLabel,
  isOnline,
  required,
  STAGE_STATUS_DISPLAY,
  entryName,
} from '../format';
import {
  DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS,
  gateConfigUrl,
} from '@rally-gate/shared';
import { useRouter } from 'vue-router';

const props = defineProps<{ gateId: string }>();
const router = useRouter();

/** One mapping for a detection's fate, so the column reads at a glance.
 *  `label` and `hint` are message keys. */
const DETECTION_STATE_DISPLAY = {
  pending: {
    label: 'detection.pending',
    color: 'error',
    icon: 'mdi-alert',
    hint: 'detection.pendingHint',
  },
  awaiting: {
    label: 'detection.awaiting',
    color: 'warning',
    icon: 'mdi-account-question',
    hint: 'detection.awaitingHint',
  },
  unknown: {
    label: 'detection.unknown',
    color: 'timing-idle',
    icon: 'mdi-help-circle-outline',
    hint: 'detection.unknownHint',
  },
  processed: {
    label: 'detection.processed',
    color: 'success',
    icon: 'mdi-check',
    hint: 'detection.processedHint',
  },
} as const;

function detectionState(event: DetectionEventRecord) {
  if (event.processed === false) return DETECTION_STATE_DISPLAY.pending;
  if (event.awaitingEntry) return DETECTION_STATE_DISPLAY.awaiting;
  if (!event.entryId) return DETECTION_STATE_DISPLAY.unknown;
  return DETECTION_STATE_DISPLAY.processed;
}

const gate = ref<Gate | null>(null);
const loaded = ref(false);
const assignments = ref<GateAssignment[]>([]);
const stages = ref<Stage[]>([]);
const entries = ref<Entry[]>([]);
const detections = ref<DetectionEventRecord[]>([]);
const clockCorrectionThresholdMs = ref(DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS);

let liveSource: EventSource | undefined;

const online = computed(
  () => !!gate.value && isOnline(gate.value, serverNow.value),
);

/** Status comes from the stage: an assignment is active exactly while its
 *  stage runs, so the stage also tells planned from done. */
const gateAssignments = computed(() =>
  assignments.value
    .filter((a) => a.gateId === props.gateId)
    .map((assignment) => ({
      assignment,
      stage: stages.value.find((s) => s.id === assignment.stageId),
    }))
    .sort((a, b) => (a.stage?.stageNumber ?? 0) - (b.stage?.stageNumber ?? 0)),
);

const renameOpen = ref(false);
const renameDraft = ref({ name: '' });

function openRename() {
  renameDraft.value = { name: gate.value?.name ?? '' };
  renameOpen.value = true;
}

async function onRename() {
  gate.value = await upsertGate(props.gateId, {
    name: renameDraft.value.name.trim(),
  });
}

/** Same cap as the server's list, so the page doesn't grow while open. */
const DETECTION_LIMIT = 100;

function upsertDetection(event: DetectionEventRecord) {
  if (event.gateId !== props.gateId) return;
  upsert(detections.value, event, 'eventId', { first: true });
  detections.value.splice(DETECTION_LIMIT);
}

async function refreshDetections() {
  detections.value = await fetchRecentEvents(props.gateId);
}

async function load() {
  loaded.value = false;
  [
    gate.value,
    assignments.value,
    stages.value,
    entries.value,
    detections.value,
  ] = await Promise.all([
    fetchGate(props.gateId),
    fetchGateAssignments(),
    fetchStages(),
    fetchEntries(),
    fetchRecentEvents(props.gateId),
  ]);
  loaded.value = true;
}

watch(() => props.gateId, load);

onMounted(async () => {
  void load();
  clockCorrectionThresholdMs.value = await fetchClockCorrectionThresholdMs();
  liveSource = openLiveStream(
    {
      gate: (updated) => {
        if (updated.id === props.gateId) gate.value = updated;
      },
      detection: upsertDetection,
      // A retry or a marshal's assignment changes a stored detection, which
      // the stream announces only as these lists changing.
      'pending-detections': refreshDetections,
      'awaiting-detections': refreshDetections,
    },
    // A reconnect may have missed detections.
    refreshDetections,
  );
});

onUnmounted(() => {
  if (liveSource) closeLiveStream(liveSource);
});
</script>

<template>
  <v-btn
    variant="text"
    prepend-icon="mdi-arrow-left"
    to="/hardware"
    class="mb-4"
  >
    {{ $t('gateDetail.back') }}
  </v-btn>

  <v-alert v-if="loaded && !gate" type="info" variant="tonal">
    {{ $t('gateDetail.notFound', { id: gateId }) }}
  </v-alert>

  <template v-if="gate">
    <div class="rg-gate-grid mb-4">
      <v-card>
        <v-card-item>
          <v-card-title>{{ gate.name }}</v-card-title>
          <v-card-subtitle class="rg-timing">{{ gate.id }}</v-card-subtitle>
          <template #append>
            <v-btn
              variant="tonal"
              prepend-icon="mdi-pencil"
              @click="openRename"
            >
              {{ $t('gateDetail.rename') }}
            </v-btn>
          </template>
        </v-card-item>
        <v-card-text>
          <dl class="rg-facts">
            <dt>{{ $t('table.status') }}</dt>
            <dd>
              <GateOnlineChip :gate="gate" />
              <span
                v-tooltip:top="
                  gate.lastHeartbeatAt
                    ? formatClockTime(gate.lastHeartbeatAt)
                    : ''
                "
                class="text-medium-emphasis ml-2"
              >
                {{
                  gate.lastHeartbeatAt
                    ? $t('gateDetail.heartbeat', {
                        ago: formatRelativeTime(
                          gate.lastHeartbeatAt,
                          serverNow,
                        ),
                      })
                    : $t('gateDetail.neverSeen')
                }}
              </span>
            </dd>

            <dt>{{ $t('gate.clock') }}</dt>
            <dd>
              <GateClockChips
                :gate="gate"
                :correction-threshold-ms="clockCorrectionThresholdMs"
              />
            </dd>

            <dt>{{ $t('gateDetail.address') }}</dt>
            <dd>
              <template v-if="gate.address">
                <span class="rg-timing">{{ gate.address }}</span>
                <v-btn
                  v-if="online"
                  :href="gateConfigUrl(gate.address)"
                  target="_blank"
                  size="small"
                  variant="text"
                  append-icon="mdi-open-in-new"
                  class="ml-2"
                >
                  {{ $t('gateDetail.gateConfig') }}
                </v-btn>
              </template>
              <span v-else>-</span>
            </dd>

            <dt>{{ $t('gate.version') }}</dt>
            <dd><GateVersion :gate="gate" /></dd>

            <dt>{{ $t('gate.capabilities') }}</dt>
            <dd>{{ gate.capabilities ?? '-' }}</dd>
          </dl>
        </v-card-text>
      </v-card>

      <v-card>
        <v-card-title>{{ $t('gateDetail.assignments') }}</v-card-title>
        <v-card-subtitle>{{
          $t('gateDetail.assignmentsHint')
        }}</v-card-subtitle>
        <v-table density="comfortable" hover>
          <thead>
            <tr>
              <th>{{ $t('entryDetail.stage') }}</th>
              <th>{{ $t('stage.role') }}</th>
              <th>{{ $t('gateDetail.stageStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{ assignment, stage } in gateAssignments"
              :key="assignment.id"
              class="cursor-pointer"
              @click="router.push(`/setup/stages/${assignment.stageId}`)"
            >
              <td>
                {{ assignment.stageId }}
                <template v-if="stage">· {{ stage.name }}</template>
              </td>
              <td>{{ gateRoleLabel(assignment) }}</td>
              <td>
                <StatusChip
                  v-if="stage"
                  :display="STAGE_STATUS_DISPLAY[stage.status]"
                />
              </td>
            </tr>
            <tr v-if="gateAssignments.length === 0">
              <td colspan="3" class="rg-empty">
                {{ $t('gateDetail.noAssignments') }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </div>

    <v-card>
      <v-card-title>{{ $t('gateDetail.detections') }}</v-card-title>
      <v-card-subtitle>
        {{ $t('gateDetail.detectionsHint', { n: detections.length }) }}
      </v-card-subtitle>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="rg-time">{{ $t('gateDetail.gateTime') }}</th>
            <th class="rg-time">{{ $t('gateDetail.correction') }}</th>
            <th class="rg-time">{{ $t('gateDetail.received') }}</th>
            <th>{{ $t('entries.transponder') }}</th>
            <th>{{ $t('gateDetail.entry') }}</th>
            <th>{{ $t('gateDetail.state') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in detections" :key="event.eventId">
            <td class="rg-timing rg-time">
              {{ formatClockTime(event.timestampGate) }}
            </td>
            <td class="rg-timing rg-time">
              {{
                event.clockCorrectionMs
                  ? formatClockOffset(event.clockCorrectionMs)
                  : '-'
              }}
            </td>
            <td class="rg-timing rg-time">
              {{ formatClockTime(event.timestampServer) }}
            </td>
            <td class="rg-timing">{{ event.transponderId ?? '-' }}</td>
            <td>
              {{ event.entryId ? entryName(entries, event.entryId) : '-' }}
            </td>
            <td>
              <v-chip
                size="small"
                :color="detectionState(event).color"
                :prepend-icon="detectionState(event).icon"
                v-tooltip:top="$t(detectionState(event).hint)"
              >
                {{ $t(detectionState(event).label) }}
              </v-chip>
            </td>
          </tr>
          <tr v-if="detections.length === 0">
            <td colspan="6" class="rg-empty">
              {{ $t('gateDetail.noDetections') }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </template>

  <FormDialog
    v-model="renameOpen"
    :title="$t('gateDetail.renameTitle', { id: gateId })"
    :form="renameDraft"
    :save="onRename"
    :saved="$t('gateDetail.renamed')"
    :save-text="$t('gateDetail.rename')"
  >
    <v-text-field
      v-model="renameDraft.name"
      :label="$t('stages.name')"
      :rules="[required]"
      autofocus
    />
  </FormDialog>
</template>

<style scoped>
.rg-gate-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 959px) {
  .rg-gate-grid {
    grid-template-columns: 1fr;
  }
}
</style>
