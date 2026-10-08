<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ApiError } from '../api/client';
import {
  fetchEventInfo,
  fetchKnownGates,
  forgetKnownGate,
  type KnownGate,
} from '../api/event';
import {
  fetchGateAssignments,
  type GateAssignment,
} from '../api/gate-assignments';
import {
  deleteGate,
  fetchGates,
  powerOffAllGates,
  upsertGate,
  type Gate,
  type GatePowerOffResult,
} from '../api/gates';
import { closeLiveStream, openLiveStream, upsert } from '../api/live';
import { serverNow } from '../api/time';
import {
  CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS,
  fetchClockCorrectionThresholdMs,
  fetchSetting,
  saveSetting,
} from '../api/settings';
import { fetchStages, type Stage } from '../api/stages';
import { StageStatus } from '@rally-gate/shared';
import {
  formatClockTime,
  formatRelativeTime,
  notify,
  notifyError,
  useConfirm,
} from '@rally-gate/ui';
import FormDialog from '../components/FormDialog.vue';
import GateClockChips from '../components/GateClockChips.vue';
import GateOnlineChip from '../components/GateOnlineChip.vue';
import GateVersion from '../components/GateVersion.vue';
import { useRouter } from 'vue-router';
import { gateConfigUrl, isOnline, required } from '../format';

const AUTO_DISCOVER_KEY = 'autoDiscoverGates';

let gatesSource: EventSource;

const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const stages = ref<Stage[]>([]);
const autoDiscover = ref(true);
const clockCorrectionThresholdMs = ref(CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS);
const gateDialogOpen = ref(false);
const gateDraft = ref({ id: '', name: '' });
const confirm = useConfirm();
const router = useRouter();
/** Null when this server keeps no per-computer list (DB_PATH, Postgres). */
const knownGates = ref<KnownGate[] | null>(null);

const confirmingPowerOff = ref(false);
const poweringOff = ref(false);
const powerOffResults = ref<GatePowerOffResult[] | null>(null);
const stageActive = computed(() =>
  stages.value.some((s) => s.status === StageStatus.ACTIVE),
);

/** Never disabled: a disabled button can't say why, so it says it here. */
function onShutDownAll() {
  if (stageActive.value) {
    notifyError(new Error('A stage is active — close it first'));
    return;
  }
  confirmingPowerOff.value = true;
}

async function onPowerOffAll() {
  poweringOff.value = true;
  try {
    powerOffResults.value = await powerOffAllGates();
  } catch (err) {
    confirmingPowerOff.value = false;
    throw err;
  } finally {
    poweringOff.value = false;
  }
}

function closePowerOff() {
  confirmingPowerOff.value = false;
  powerOffResults.value = null;
}

const gateIds = computed(() => new Set(gates.value.map((g) => g.id)));

/** Gates referenced by an ACTIVE/CLOSED stage's assignment — those
 * assignments can't be removed, so the gate can't be deleted at all. */
const lockedGateIds = computed(() => {
  const lockedStageIds = new Set(
    stages.value
      .filter((s) => s.status !== StageStatus.NOT_STARTED)
      .map((s) => s.id),
  );
  return new Set(
    gateAssignments.value
      .filter((a) => lockedStageIds.has(a.stageId))
      .map((a) => a.gateId),
  );
});

async function refreshGates() {
  [gates.value, gateAssignments.value, stages.value] = await Promise.all([
    fetchGates(),
    fetchGateAssignments(),
    fetchStages(),
  ]);
}

function openGateDialog() {
  gateDraft.value = { id: '', name: '' };
  gateDialogOpen.value = true;
}

async function onSaveGate() {
  const id = gateDraft.value.id.trim();
  await upsertGate(id, { name: gateDraft.value.name.trim() || id });
  await refreshGates();
}

async function onDeleteGate(gate: Gate, force = false) {
  try {
    await deleteGate(gate.id, force);
    gates.value = gates.value.filter((g) => g.id !== gate.id);
    notify('Gate deleted');
  } catch (err) {
    const conflict = err instanceof ApiError && err.status === 409 ? err : null;
    const assignmentCount = (
      conflict?.body as { assignmentCount?: number } | null
    )?.assignmentCount;
    if (!conflict || !assignmentCount) throw err;
    if (
      await confirm({
        title: 'Delete gate and its assignments?',
        text: conflict.message,
        confirmText: 'Delete gate and assignments',
        color: 'error',
      })
    )
      await onDeleteGate(gate, true);
  }
}

async function onAddKnownGate(gate: KnownGate) {
  await upsertGate(gate.id, { name: gate.name });
  await refreshGates();
}

async function onForgetKnownGate(id: string) {
  await forgetKnownGate(id);
  knownGates.value = knownGates.value?.filter((g) => g.id !== id) ?? null;
}

async function onToggleAutoDiscover(value: boolean | null) {
  autoDiscover.value = value ?? true;
  await saveSetting(AUTO_DISCOVER_KEY, String(autoDiscover.value));
}

onMounted(async () => {
  const [, eventInfo, autoDiscoverSetting, thresholdMs] = await Promise.all([
    refreshGates(),
    fetchEventInfo(),
    fetchSetting(AUTO_DISCOVER_KEY),
    fetchClockCorrectionThresholdMs(),
  ]);
  if (eventInfo.switchable) {
    knownGates.value = await fetchKnownGates();
  }
  autoDiscover.value = autoDiscoverSetting !== 'false';
  clockCorrectionThresholdMs.value = thresholdMs;
  gatesSource = openLiveStream(
    { gate: (gate) => upsert(gates.value, gate, 'id') },
    async () => {
      gates.value = await fetchGates();
    },
  );
});

onUnmounted(() => {
  if (gatesSource) closeLiveStream(gatesSource);
});
</script>

<template>
  <v-card class="mb-6">
    <v-card-title class="d-flex align-center">
      Gates
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-plus" @click="openGateDialog">
        Add Gate
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-switch
        :model-value="autoDiscover"
        label="Auto-discover new gates from their first heartbeat"
        color="primary"
        density="comfortable"
        hide-details
        class="mb-4"
        @update:model-value="onToggleAutoDiscover"
      />
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Online</th>
            <th>Last Heartbeat</th>
            <th>Clock</th>
            <th>Capabilities</th>
            <th>Version</th>
            <th width="1%"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="gate in gates"
            :key="gate.id"
            class="cursor-pointer"
            @click="router.push(`/hardware/gates/${gate.id}`)"
          >
            <td class="text-no-wrap">{{ gate.id }}</td>
            <td>{{ gate.name }}</td>
            <td><GateOnlineChip :gate="gate" /></td>
            <td
              v-tooltip:top="
                gate.lastHeartbeatAt
                  ? formatClockTime(gate.lastHeartbeatAt)
                  : ''
              "
            >
              {{
                gate.lastHeartbeatAt
                  ? formatRelativeTime(gate.lastHeartbeatAt, serverNow)
                  : 'never'
              }}
            </td>
            <td class="text-no-wrap">
              <GateClockChips
                :gate="gate"
                :correction-threshold-ms="clockCorrectionThresholdMs"
              />
            </td>
            <td>{{ gate.capabilities ?? '-' }}</td>
            <td><GateVersion :gate="gate" /></td>
            <td class="text-no-wrap">
              <v-menu>
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    size="small"
                    variant="text"
                    :aria-label="`More for ${gate.id}`"
                    @click.stop
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-open-in-new"
                    title="Open gate config"
                    :subtitle="
                      gate.address && isOnline(gate, serverNow)
                        ? gate.address
                        : 'Gate offline'
                    "
                    :href="
                      gate.address && isOnline(gate, serverNow)
                        ? gateConfigUrl(gate.address)
                        : undefined
                    "
                    target="_blank"
                    :disabled="!gate.address || !isOnline(gate, serverNow)"
                  />
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    title="Delete"
                    :subtitle="
                      lockedGateIds.has(gate.id)
                        ? 'Used by a running or closed stage'
                        : undefined
                    "
                    base-color="error"
                    :disabled="lockedGateIds.has(gate.id)"
                    @click="onDeleteGate(gate)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr v-if="gates.length === 0">
            <td colspan="8" class="rg-empty">
              No gates yet — waiting for a gate-agent heartbeat.
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-alert v-if="!autoDiscover" type="warning" variant="tonal" class="mt-4">
        Auto-discovery is off — heartbeats from gates not listed here are
        ignored until you add them with + Add Gate.
      </v-alert>
    </v-card-text>
    <v-card-actions>
      <v-btn
        variant="text"
        color="error"
        prepend-icon="mdi-power"
        @click="onShutDownAll"
      >
        Shut down all gates
      </v-btn>
    </v-card-actions>
  </v-card>

  <v-card v-if="knownGates">
    <v-card-title>Known on This Computer</v-card-title>
    <v-card-subtitle>
      Every gate this computer has seen, across all events. Add the ones this
      event uses; forgetting one leaves the open event as it is.
    </v-card-subtitle>
    <v-table density="comfortable">
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th width="1%"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="gate in knownGates" :key="gate.id">
          <td>{{ gate.id }}</td>
          <td>{{ gate.name }}</td>
          <td class="text-no-wrap text-right">
            <v-chip v-if="gateIds.has(gate.id)" size="small" class="mr-2">
              in this event
            </v-chip>
            <v-btn
              v-else
              size="small"
              variant="text"
              prepend-icon="mdi-plus"
              @click="onAddKnownGate(gate)"
            >
              Add
            </v-btn>
            <v-menu>
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  size="small"
                  variant="text"
                  :aria-label="`More for ${gate.id}`"
                />
              </template>
              <v-list density="compact">
                <v-list-item
                  prepend-icon="mdi-close"
                  title="Forget on this computer"
                  @click="onForgetKnownGate(gate.id)"
                />
              </v-list>
            </v-menu>
          </td>
        </tr>
        <tr v-if="knownGates.length === 0">
          <td colspan="3" class="rg-empty">
            None yet — every gate that sends a heartbeat or is added above is
            remembered.
          </td>
        </tr>
      </tbody>
    </v-table>
  </v-card>

  <v-dialog :model-value="confirmingPowerOff" max-width="480" persistent>
    <v-card>
      <v-card-title>Shut down all gates?</v-card-title>
      <v-card-text v-if="!powerOffResults">
        Every online gate powers off and has to be switched back on by hand. Use
        this after the event, before pulling their power.
      </v-card-text>
      <v-card-text v-else>
        <div v-if="powerOffResults.length === 0">No gate was online.</div>
        <div v-for="r in powerOffResults" :key="r.gateId">
          <v-icon
            :icon="r.ok ? 'mdi-check' : 'mdi-alert'"
            :color="r.ok ? 'success' : 'error'"
            size="small"
          />
          {{ r.gateId }}: {{ r.ok ? 'shutting down' : r.message }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="!powerOffResults">
          <v-btn variant="text" @click="closePowerOff">Cancel</v-btn>
          <v-btn color="error" :loading="poweringOff" @click="onPowerOffAll">
            Shut down
          </v-btn>
        </template>
        <v-btn v-else variant="text" @click="closePowerOff">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <FormDialog
    v-model="gateDialogOpen"
    title="Add gate"
    :form="gateDraft"
    :save="onSaveGate"
    saved="Gate added"
    save-text="Add gate"
  >
    <v-text-field
      v-model="gateDraft.id"
      label="Gate ID"
      hint="Its GATE_ID, e.g. START_WP2"
      persistent-hint
      :rules="[required]"
      autofocus
    />
    <v-text-field v-model="gateDraft.name" label="Name (optional)" />
  </FormDialog>
</template>
