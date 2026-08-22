<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ApiError } from '../api/client';
import {
  fetchGateAssignments,
  type GateAssignment,
} from '../api/gate-assignments';
import { deleteGate, fetchGates, upsertGate, type Gate } from '../api/gates';
import { fetchSetting, saveSetting } from '../api/settings';
import { fetchStages, type Stage } from '../api/stages';
import { formatClockTime, formatRelativeTime } from '@rally-gate/ui';
import {
  clockOffsetColor,
  clockOffsetHint,
  formatClockOffset,
  isOnline,
} from '../format';

const AUTO_DISCOVER_KEY = 'autoDiscoverGates';
const CLOCK_CORRECTION_THRESHOLD_KEY = 'clockCorrectionThresholdMs';
/** Mirrors DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS; only used until the real
 * value arrives from settings, so the two can't drift in practice. */
const CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS = 1_000;

const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval>;

const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const stages = ref<Stage[]>([]);
const autoDiscover = ref(true);
const clockCorrectionThresholdMs = ref(CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS);
const newGate = ref({ id: '', name: '' });
const creatingGate = ref(false);
const editingGateId = ref<string | null>(null);
const deleteConflictGate = ref<Gate | null>(null);
const deleteConflictMessage = ref('');

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

function toggleEditGate(gateId: string) {
  editingGateId.value = editingGateId.value === gateId ? null : gateId;
}

async function onRenameGate(gate: Gate, name: string) {
  if (!name || name === gate.name) return;
  await upsertGate(gate.id, { name });
  await refreshGates();
}

async function onDeleteGate(gate: Gate, force = false) {
  try {
    await deleteGate(gate.id, force);
    gates.value = gates.value.filter((g) => g.id !== gate.id);
    deleteConflictGate.value = null;
  } catch (err) {
    // Narrowed into a local so the type survives into the branch below —
    // `err instanceof ApiError` inside the ternary doesn't carry past it,
    // which is why `err.message` was an error on `unknown`.
    const conflict = err instanceof ApiError && err.status === 409 ? err : null;
    const assignmentCount = (
      conflict?.body as { assignmentCount?: number } | null
    )?.assignmentCount;
    if (conflict && assignmentCount) {
      deleteConflictGate.value = gate;
      deleteConflictMessage.value = conflict.message;
    } else {
      alert(err instanceof Error ? err.message : 'Failed to delete gate');
    }
  }
}

function onConfirmDeleteGate() {
  if (deleteConflictGate.value) onDeleteGate(deleteConflictGate.value, true);
}

async function onToggleAutoDiscover(value: boolean | null) {
  autoDiscover.value = value ?? true;
  await saveSetting(AUTO_DISCOVER_KEY, String(autoDiscover.value));
}

async function onCreateGate() {
  if (!newGate.value.id || creatingGate.value) return;
  creatingGate.value = true;
  try {
    await upsertGate(newGate.value.id, {
      name: newGate.value.name || newGate.value.id,
    });
    newGate.value = { id: '', name: '' };
    await refreshGates();
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to add gate');
  } finally {
    creatingGate.value = false;
  }
}

onMounted(async () => {
  await refreshGates();
  autoDiscover.value = (await fetchSetting(AUTO_DISCOVER_KEY)) !== 'false';
  clockCorrectionThresholdMs.value =
    Number(await fetchSetting(CLOCK_CORRECTION_THRESHOLD_KEY)) ||
    CLOCK_CORRECTION_THRESHOLD_FALLBACK_MS;
  nowTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  clearInterval(nowTimer);
});
</script>

<template>
  <v-card class="mb-6">
    <v-card-title>Gates</v-card-title>
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="gate in gates" :key="gate.id">
            <td>{{ gate.id }}</td>
            <td>
              <v-text-field
                v-if="editingGateId === gate.id"
                :model-value="gate.name"
                density="compact"
                hide-details
                @change="
                  onRenameGate(gate, ($event.target as HTMLInputElement).value)
                "
              />
              <span v-else>{{ gate.name }}</span>
            </td>
            <td>
              <v-chip
                size="small"
                :color="isOnline(gate, now) ? 'success' : 'error'"
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
            </td>
            <td>{{ gate.capabilities ?? '-' }}</td>
            <td>
              <v-btn
                size="small"
                variant="text"
                :prepend-icon="
                  editingGateId === gate.id ? 'mdi-check' : 'mdi-pencil'
                "
                @click="toggleEditGate(gate.id)"
              >
                {{ editingGateId === gate.id ? 'Done' : 'Rename' }}
              </v-btn>
              <v-tooltip
                :disabled="!lockedGateIds.has(gate.id)"
                text="Referenced by an active/closed stage — can't be deleted"
              >
                <template #activator="{ props: tooltipProps }">
                  <span v-bind="tooltipProps">
                    <v-btn
                      size="small"
                      variant="text"
                      color="error"
                      prepend-icon="mdi-delete"
                      :disabled="lockedGateIds.has(gate.id)"
                      @click="onDeleteGate(gate)"
                    >
                      Delete
                    </v-btn>
                  </span>
                </template>
              </v-tooltip>
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-alert v-if="gates.length === 0" type="info" variant="tonal">
        No gates yet — waiting for a gate-agent heartbeat.
      </v-alert>
      <v-alert v-if="!autoDiscover" type="warning" variant="tonal" class="mt-4">
        Auto-discovery is off — heartbeats from gates not listed here are
        ignored until you add them below.
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3 mt-4"
        @submit.prevent="onCreateGate"
      >
        <v-text-field
          v-model="newGate.id"
          label="Gate ID (e.g. START_WP2)"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-text-field
          v-model="newGate.name"
          label="Name (optional)"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="creatingGate"
          prepend-icon="mdi-plus"
        >
          Add Gate
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-dialog :model-value="!!deleteConflictGate" max-width="480">
    <v-card>
      <v-card-title>Delete gate and its assignments?</v-card-title>
      <v-card-text>{{ deleteConflictMessage }}</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="deleteConflictGate = null">
          Cancel
        </v-btn>
        <v-btn color="error" @click="onConfirmDeleteGate">
          Delete gate and assignments
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
