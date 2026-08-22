<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import {
  deleteGate,
  fetchGateAssignments,
  fetchGates,
  fetchSetting,
  fetchStages,
  saveSetting,
  upsertGate,
  type Gate,
  type GateAssignment,
  type Stage,
} from '../api';
import { formatClockTime, formatRelativeTime } from '@rally-gate/ui';
import { isOnline, stageName } from '../format';

const AUTO_DISCOVER_KEY = 'autoDiscoverGates';

const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval>;

const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const stages = ref<Stage[]>([]);
const autoDiscover = ref(true);
const newGate = ref({ id: '', name: '' });
const creatingGate = ref(false);
const editingGateId = ref<string | null>(null);

async function refreshGates() {
  gates.value = await fetchGates();
}

function toggleEditGate(gateId: string) {
  editingGateId.value = editingGateId.value === gateId ? null : gateId;
}

async function onRenameGate(gate: Gate, name: string) {
  if (!name || name === gate.name) return;
  await upsertGate(gate.id, { name });
  await refreshGates();
}

async function onDeleteGate(gate: Gate) {
  await deleteGate(gate.id);
  gates.value = gates.value.filter((g) => g.id !== gate.id);
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
  gateAssignments.value = await fetchGateAssignments();
  stages.value = await fetchStages();
  autoDiscover.value = (await fetchSetting(AUTO_DISCOVER_KEY)) !== 'false';
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
            <th>Capabilities</th>
            <th>Active Assignment</th>
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
                :color="isOnline(gate, now) ? 'success' : 'timing-idle'"
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
            <td>{{ gate.capabilities ?? '-' }}</td>
            <td>
              <v-chip
                v-for="assignment in gateAssignments.filter(
                  (a) => a.gateId === gate.id && a.active,
                )"
                :key="assignment.id"
                size="small"
                class="mr-1"
              >
                {{ assignment.role }} @
                {{ stageName(stages, assignment.stageId) }}
              </v-chip>
            </td>
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
              <v-btn
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete"
                @click="onDeleteGate(gate)"
              >
                Delete
              </v-btn>
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
</template>
