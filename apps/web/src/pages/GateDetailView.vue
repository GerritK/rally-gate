<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { formatClockTime, formatRelativeTime } from '@rally-gate/ui';
import { fetchRecentEvents, type DetectionEventRecord } from '../api/events';
import {
  fetchGateAssignments,
  type GateAssignment,
} from '../api/gate-assignments';
import { fetchGate, upsertGate, type Gate } from '../api/gates';
import { closeLiveStream, openLiveStream } from '../api/live';
import {
  CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS,
  fetchClockCorrectionThresholdMs,
} from '../api/settings';
import { fetchStages, type Stage } from '../api/stages';
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import { serverVersion } from '../api/version';
import FormDialog from '../components/FormDialog.vue';
import GateClockChips from '../components/GateClockChips.vue';
import {
  formatClockOffset,
  gateConfigUrl,
  gateRoleLabel,
  isOnline,
  required,
  STAGE_STATUS_DISPLAY,
  vehicleName,
} from '../format';
import { useRouter } from 'vue-router';

const props = defineProps<{ gateId: string }>();
const router = useRouter();

/** One mapping for a detection's fate, so the column reads at a glance. */
const DETECTION_STATE_DISPLAY = {
  pending: {
    label: 'Rules failed',
    color: 'error',
    icon: 'mdi-alert',
    hint: 'Stored but not timed yet; the server retries every 30 s.',
  },
  awaiting: {
    label: 'Unassigned',
    color: 'warning',
    icon: 'mdi-account-question',
    hint: 'No transponder: waiting for a marshal on Live Timing.',
  },
  unknown: {
    label: 'Unknown car',
    color: 'timing-idle',
    icon: 'mdi-help-circle-outline',
    hint: 'No vehicle has this transponder, so nothing was timed.',
  },
  processed: {
    label: 'Processed',
    color: 'success',
    icon: 'mdi-check',
    hint: 'Handed to the stage rules.',
  },
} as const;

function detectionState(event: DetectionEventRecord) {
  if (event.processed === false) return DETECTION_STATE_DISPLAY.pending;
  if (event.awaitingVehicle) return DETECTION_STATE_DISPLAY.awaiting;
  if (!event.vehicleId) return DETECTION_STATE_DISPLAY.unknown;
  return DETECTION_STATE_DISPLAY.processed;
}

const gate = ref<Gate | null>(null);
const loaded = ref(false);
const assignments = ref<GateAssignment[]>([]);
const stages = ref<Stage[]>([]);
const vehicles = ref<Vehicle[]>([]);
const detections = ref<DetectionEventRecord[]>([]);
const clockCorrectionThresholdMs = ref(CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS);

const now = ref(Date.now());
const nowTimer = setInterval(() => (now.value = Date.now()), 1000);
let liveSource: EventSource | undefined;

const online = computed(() => !!gate.value && isOnline(gate.value, now.value));

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

function upsertDetection(event: DetectionEventRecord) {
  if (event.gateId !== props.gateId) return;
  const idx = detections.value.findIndex((d) => d.eventId === event.eventId);
  if (idx === -1) detections.value.unshift(event);
  else detections.value[idx] = event;
}

async function load() {
  loaded.value = false;
  [
    gate.value,
    assignments.value,
    stages.value,
    vehicles.value,
    detections.value,
  ] = await Promise.all([
    fetchGate(props.gateId),
    fetchGateAssignments(),
    fetchStages(),
    fetchVehicles(),
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
    },
    // A reconnect may have missed detections.
    () => {
      void fetchRecentEvents(props.gateId).then((d) => (detections.value = d));
    },
  );
});

onUnmounted(() => {
  if (liveSource) closeLiveStream(liveSource);
  clearInterval(nowTimer);
});
</script>

<template>
  <v-btn
    variant="text"
    prepend-icon="mdi-arrow-left"
    to="/hardware"
    class="mb-4"
  >
    Back to Hardware
  </v-btn>

  <v-alert v-if="loaded && !gate" type="info" variant="tonal">
    No gate {{ gateId }} in this event. It appears once it sends a heartbeat, or
    add it on Hardware.
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
              Rename
            </v-btn>
          </template>
        </v-card-item>
        <v-card-text>
          <dl class="rg-facts">
            <dt>Status</dt>
            <dd>
              <v-chip
                size="small"
                :color="online ? 'success' : 'error'"
                :prepend-icon="
                  online ? 'mdi-lan-connect' : 'mdi-lan-disconnect'
                "
              >
                {{ online ? 'online' : 'offline' }}
              </v-chip>
              <span
                class="text-medium-emphasis ml-2"
                :title="
                  gate.lastHeartbeatAt
                    ? formatClockTime(gate.lastHeartbeatAt)
                    : undefined
                "
              >
                {{
                  gate.lastHeartbeatAt
                    ? `heartbeat ${formatRelativeTime(gate.lastHeartbeatAt, now)}`
                    : 'never seen'
                }}
              </span>
            </dd>

            <dt>Clock</dt>
            <dd>
              <GateClockChips
                :gate="gate"
                :correction-threshold-ms="clockCorrectionThresholdMs"
              />
            </dd>

            <dt>Address</dt>
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
                  Gate config
                </v-btn>
              </template>
              <span v-else>-</span>
            </dd>

            <dt>Version</dt>
            <dd>
              <v-chip
                v-if="
                  gate.version &&
                  serverVersion &&
                  gate.version !== serverVersion
                "
                size="small"
                color="warning"
                prepend-icon="mdi-alert"
              >
                {{ gate.version }} — server runs {{ serverVersion }}
              </v-chip>
              <span v-else class="rg-timing">{{ gate.version ?? '-' }}</span>
            </dd>

            <dt>Capabilities</dt>
            <dd>{{ gate.capabilities ?? '-' }}</dd>
          </dl>
        </v-card-text>
      </v-card>

      <v-card>
        <v-card-title>Assignments</v-card-title>
        <v-card-subtitle
          >Planned on each stage's page; a row opens it.</v-card-subtitle
        >
        <v-table density="comfortable" hover>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Role</th>
              <th>Stage status</th>
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
                <v-chip
                  v-if="stage"
                  size="small"
                  :color="STAGE_STATUS_DISPLAY[stage.status].color"
                  :prepend-icon="STAGE_STATUS_DISPLAY[stage.status].icon"
                >
                  {{ STAGE_STATUS_DISPLAY[stage.status].label }}
                </v-chip>
              </td>
            </tr>
            <tr v-if="gateAssignments.length === 0">
              <td colspan="3" class="text-center text-medium-emphasis">
                Not assigned to any stage.
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </div>

    <v-card>
      <v-card-title>Detections</v-card-title>
      <v-card-subtitle>
        The last {{ detections.length }} this gate reported, newest first.
        Corrected time = gate time + correction.
      </v-card-subtitle>
      <v-table density="compact">
        <thead>
          <tr>
            <th>Gate time</th>
            <th>Correction</th>
            <th>Received</th>
            <th>Transponder</th>
            <th>Vehicle</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in detections" :key="event.eventId">
            <td class="rg-timing">
              {{ formatClockTime(event.timestampGate) }}
            </td>
            <td class="rg-timing">
              {{
                event.clockCorrectionMs
                  ? formatClockOffset(event.clockCorrectionMs)
                  : '-'
              }}
            </td>
            <td class="rg-timing">
              {{ formatClockTime(event.timestampServer) }}
            </td>
            <td class="rg-timing">{{ event.transponderId ?? '-' }}</td>
            <td>
              {{
                event.vehicleId ? vehicleName(vehicles, event.vehicleId) : '-'
              }}
            </td>
            <td>
              <v-chip
                size="small"
                :color="detectionState(event).color"
                :prepend-icon="detectionState(event).icon"
                :title="detectionState(event).hint"
              >
                {{ detectionState(event).label }}
              </v-chip>
            </td>
          </tr>
          <tr v-if="detections.length === 0">
            <td colspan="6" class="text-center text-medium-emphasis">
              No detections yet.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </template>

  <FormDialog
    v-model="renameOpen"
    :title="`Rename gate ${gateId}`"
    :form="renameDraft"
    :save="onRename"
    saved="Gate renamed"
    save-text="Rename"
  >
    <v-text-field
      v-model="renameDraft.name"
      label="Name"
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
.rg-facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 12px 24px;
  align-items: center;
}
.rg-facts dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.rg-facts dd {
  margin: 0;
}
</style>
