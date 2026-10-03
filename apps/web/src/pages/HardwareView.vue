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
import { closeLiveStream, openLiveStream } from '../api/live';
import { serverVersion } from '../api/version';
import { fetchSetting, saveSetting } from '../api/settings';
import { fetchStages, type Stage } from '../api/stages';
import { GATE_CONFIG_PORT, StageStatus } from '@rally-gate/shared';
import {
  formatClockTime,
  formatRelativeTime,
  notify,
  useConfirm,
} from '@rally-gate/ui';
import FormDialog from '../components/FormDialog.vue';
import {
  clockOffsetColor,
  clockOffsetHint,
  formatClockOffset,
  isOnline,
  required,
} from '../format';

const AUTO_DISCOVER_KEY = 'autoDiscoverGates';
const CLOCK_CORRECTION_THRESHOLD_KEY = 'clockCorrectionThresholdMs';
/** Mirrors DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS; only used until the real
 * value arrives from settings, so the two can't drift in practice. */
const CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS = 1_000;

const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval>;
let gatesSource: EventSource;

const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const stages = ref<Stage[]>([]);
const autoDiscover = ref(true);
const clockCorrectionThresholdMs = ref(CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS);
const gateDialogOpen = ref(false);
const editingGate = ref<Gate | null>(null);
const gateDraft = ref({ id: '', name: '' });
const confirm = useConfirm();
/** Null when this server keeps no per-computer list (DB_PATH, Postgres). */
const knownGates = ref<KnownGate[] | null>(null);

function gateConfigUrl(address: string): string {
  return `http://${address.includes(':') ? `[${address}]` : address}:${GATE_CONFIG_PORT}/`;
}

const confirmingPowerOff = ref(false);
const poweringOff = ref(false);
const powerOffResults = ref<GatePowerOffResult[] | null>(null);
const stageActive = computed(() =>
  stages.value.some((s) => s.status === StageStatus.ACTIVE),
);

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
    stages.value.filter((s) => s.status !== 'NOT_STARTED').map((s) => s.id),
  );
  return new Set(
    gateAssignments.value
      .filter((a) => lockedStageIds.has(a.stageId))
      .map((a) => a.gateId),
  );
});

async function refreshGates() {
  gates.value = await fetchGates();
  gateAssignments.value = await fetchGateAssignments();
  stages.value = await fetchStages();
}

function openGateDialog(gate: Gate | null) {
  editingGate.value = gate;
  gateDraft.value = { id: gate?.id ?? '', name: gate?.name ?? '' };
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
  await refreshGates();
  if ((await fetchEventInfo()).switchable) {
    knownGates.value = await fetchKnownGates();
  }
  autoDiscover.value = (await fetchSetting(AUTO_DISCOVER_KEY)) !== 'false';
  clockCorrectionThresholdMs.value =
    Number(await fetchSetting(CLOCK_CORRECTION_THRESHOLD_KEY)) ||
    CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS;
  gatesSource = openLiveStream(
    {
      gate: (gate) => {
        const idx = gates.value.findIndex((g) => g.id === gate.id);
        if (idx === -1) gates.value.push(gate);
        else gates.value[idx] = gate;
      },
    },
    async () => {
      gates.value = await fetchGates();
    },
  );
  nowTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (gatesSource) closeLiveStream(gatesSource);
  clearInterval(nowTimer);
});
</script>

<template>
  <v-card class="mb-6">
    <v-card-title class="d-flex align-center">
      Gates
      <v-spacer />
      <v-btn
        variant="tonal"
        prepend-icon="mdi-plus"
        @click="openGateDialog(null)"
      >
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
          <tr v-for="gate in gates" :key="gate.id">
            <td class="text-no-wrap">
              {{ gate.id }}
              <v-btn
                v-if="gate.address && isOnline(gate, now)"
                :href="gateConfigUrl(gate.address)"
                target="_blank"
                icon="mdi-open-in-new"
                size="x-small"
                variant="text"
                :title="`Open gate config (${gate.address})`"
              />
            </td>
            <td>{{ gate.name }}</td>
            <td>
              <v-chip
                size="small"
                :color="isOnline(gate, now) ? 'success' : 'error'"
                :prepend-icon="
                  isOnline(gate, now) ? 'mdi-lan-connect' : 'mdi-lan-disconnect'
                "
              >
                {{ isOnline(gate, now) ? 'online' : 'offline' }}
              </v-chip>
            </td>
            <td
              :title="
                gate.lastHeartbeatAt
                  ? formatClockTime(gate.lastHeartbeatAt)
                  : undefined
              "
            >
              {{
                gate.lastHeartbeatAt
                  ? formatRelativeTime(gate.lastHeartbeatAt, now)
                  : 'never'
              }}
            </td>
            <td>
              <v-tooltip
                :text="
                  clockOffsetHint(
                    gate.clockOffsetMs,
                    clockCorrectionThresholdMs,
                  )
                "
                location="top"
              >
                <template #activator="{ props }">
                  <v-chip
                    v-bind="props"
                    size="small"
                    class="rg-timing"
                    :color="
                      clockOffsetColor(
                        gate.clockOffsetMs,
                        clockCorrectionThresholdMs,
                      )
                    "
                    :prepend-icon="
                      gate.clockOffsetMs != null &&
                      Math.abs(gate.clockOffsetMs) >= clockCorrectionThresholdMs
                        ? 'mdi-clock-alert-outline'
                        : 'mdi-clock-check-outline'
                    "
                  >
                    {{ formatClockOffset(gate.clockOffsetMs) }}
                  </v-chip>
                </template>
              </v-tooltip>
              <v-chip
                v-if="gate.chronySynced != null"
                size="small"
                class="rg-timing ml-1"
                :color="gate.chronySynced ? 'success' : 'error'"
                :prepend-icon="
                  gate.chronySynced ? 'mdi-sync' : 'mdi-sync-alert'
                "
                :title="
                  gate.chronySynced
                    ? 'chrony on the gate is synced'
                    : 'chrony on the gate is not synced — its times are not comparable with other gates'
                "
              >
                {{
                  gate.chronySynced
                    ? `NTP ${(gate.chronyOffsetMs ?? 0).toFixed(1)} ms`
                    : 'NTP not synced'
                }}
              </v-chip>
            </td>
            <td>{{ gate.capabilities ?? '-' }}</td>
            <td>
              <!-- A gate on another build than the server is the one to
                   re-install before the event, not a curiosity. -->
              <v-chip
                v-if="
                  gate.version &&
                  serverVersion &&
                  gate.version !== serverVersion
                "
                size="small"
                color="warning"
                prepend-icon="mdi-alert"
                :title="`Server runs ${serverVersion}`"
              >
                {{ gate.version }}
              </v-chip>
              <span v-else>{{ gate.version ?? '-' }}</span>
            </td>
            <td class="text-no-wrap">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="openGateDialog(gate)"
              >
                Rename
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
        </tbody>
      </v-table>
      <v-alert v-if="gates.length === 0" type="info" variant="tonal">
        No gates yet — waiting for a gate-agent heartbeat.
      </v-alert>
      <v-alert v-if="!autoDiscover" type="warning" variant="tonal" class="mt-4">
        Auto-discovery is off — heartbeats from gates not listed here are
        ignored until you add them with + Add Gate.
      </v-alert>
    </v-card-text>
    <v-card-actions>
      <v-tooltip
        :disabled="!stageActive"
        text="A stage is active — close it first"
      >
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps">
            <v-btn
              variant="text"
              color="error"
              prepend-icon="mdi-power"
              :disabled="stageActive"
              @click="confirmingPowerOff = true"
            >
              Shut down all gates
            </v-btn>
          </span>
        </template>
      </v-tooltip>
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
          <td colspan="3" class="text-center text-medium-emphasis">
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
    :title="editingGate ? `Rename gate ${editingGate.id}` : 'Add gate'"
    :form="gateDraft"
    :save="onSaveGate"
    :saved="editingGate ? 'Gate renamed' : 'Gate added'"
    :save-text="editingGate ? 'Rename' : 'Add gate'"
  >
    <v-text-field
      v-if="!editingGate"
      v-model="gateDraft.id"
      label="Gate ID"
      hint="Its GATE_ID, e.g. START_WP2"
      persistent-hint
      :rules="[required]"
      autofocus
    />
    <v-text-field
      v-model="gateDraft.name"
      :label="editingGate ? 'Name' : 'Name (optional)'"
      :autofocus="!!editingGate"
    />
  </FormDialog>
</template>
