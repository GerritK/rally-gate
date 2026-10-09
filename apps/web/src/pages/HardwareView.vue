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
} from '../api/gates';
import { closeLiveStream, openLiveStream, upsert } from '../api/live';
import { serverNow } from '../api/time';
import {
  fetchClockCorrectionThresholdMs,
  fetchSetting,
  saveSetting,
} from '../api/settings';
import { fetchStages, type Stage } from '../api/stages';
import {
  ApiErrorCode,
  AUTO_DISCOVER_GATES_KEY,
  DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS,
  gateConfigUrl,
  StageStatus,
  type GatePowerOffResult,
} from '@rally-gate/shared';
import {
  formatClockTime,
  formatRelativeTime,
  notify,
  notifyError,
  t,
  useConfirm,
} from '@rally-gate/ui';
import FormDialog from '../components/FormDialog.vue';
import GateClockChips from '../components/GateClockChips.vue';
import GateOnlineChip from '../components/GateOnlineChip.vue';
import GateVersion from '../components/GateVersion.vue';
import { useRouter } from 'vue-router';
import { isOnline, required } from '../format';

let gatesSource: EventSource;

const gates = ref<Gate[]>([]);
const gateAssignments = ref<GateAssignment[]>([]);
const stages = ref<Stage[]>([]);
const autoDiscover = ref(true);
const clockCorrectionThresholdMs = ref(DEFAULT_CLOCK_CORRECTION_THRESHOLD_MS);
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
    notifyError(new Error(t('hardware.stageActive')));
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
    notify(t('hardware.deleted'));
  } catch (err) {
    const assignmentCount =
      err instanceof ApiError && err.code === ApiErrorCode.GATE_HAS_ASSIGNMENTS
        ? (err.params.assignmentCount as number)
        : undefined;
    if (!assignmentCount) throw err;
    if (
      await confirm({
        title: t('hardware.deleteWithAssignmentsTitle'),
        text: t(
          'hardware.deleteWithAssignmentsText',
          { id: gate.id, n: assignmentCount },
          assignmentCount,
        ),
        confirmText: t('hardware.deleteWithAssignments'),
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
  await saveSetting(AUTO_DISCOVER_GATES_KEY, String(autoDiscover.value));
}

onMounted(async () => {
  const [, eventInfo, autoDiscoverSetting, thresholdMs] = await Promise.all([
    refreshGates(),
    fetchEventInfo(),
    fetchSetting(AUTO_DISCOVER_GATES_KEY),
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
      {{ $t('hardware.gates') }}
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-plus" @click="openGateDialog">
        {{ $t('hardware.addGate') }}
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-switch
        :model-value="autoDiscover"
        :label="$t('hardware.autoDiscover')"
        color="primary"
        density="comfortable"
        hide-details
        class="mb-4"
        @update:model-value="onToggleAutoDiscover"
      />
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('stages.id') }}</th>
            <th>{{ $t('stages.name') }}</th>
            <th>{{ $t('hardware.online') }}</th>
            <th>{{ $t('hardware.lastHeartbeat') }}</th>
            <th>{{ $t('gate.clock') }}</th>
            <th>{{ $t('gate.capabilities') }}</th>
            <th>{{ $t('gate.version') }}</th>
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
                  : $t('hardware.never')
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
                    :aria-label="$t('common.moreFor', { name: gate.id })"
                    @click.stop
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-open-in-new"
                    :title="$t('hardware.openGateConfig')"
                    :subtitle="
                      gate.address && isOnline(gate, serverNow)
                        ? gate.address
                        : $t('hardware.gateOffline')
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
                    :title="$t('common.delete')"
                    :subtitle="
                      lockedGateIds.has(gate.id)
                        ? $t('hardware.locked')
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
              {{ $t('hardware.empty') }}
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-alert v-if="!autoDiscover" type="warning" variant="tonal" class="mt-4">
        {{ $t('hardware.autoDiscoverOff', { action: $t('hardware.addGate') }) }}
      </v-alert>
    </v-card-text>
    <v-card-actions>
      <v-btn
        variant="text"
        color="error"
        prepend-icon="mdi-power"
        @click="onShutDownAll"
      >
        {{ $t('hardware.shutDownAll') }}
      </v-btn>
    </v-card-actions>
  </v-card>

  <v-card v-if="knownGates">
    <v-card-title>{{ $t('hardware.known') }}</v-card-title>
    <v-card-subtitle>
      {{ $t('hardware.knownHint') }}
    </v-card-subtitle>
    <v-table density="comfortable">
      <thead>
        <tr>
          <th>{{ $t('stages.id') }}</th>
          <th>{{ $t('stages.name') }}</th>
          <th width="1%"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="gate in knownGates" :key="gate.id">
          <td>{{ gate.id }}</td>
          <td>{{ gate.name }}</td>
          <td class="text-no-wrap text-right">
            <v-chip v-if="gateIds.has(gate.id)" size="small" class="mr-2">
              {{ $t('hardware.inThisEvent') }}
            </v-chip>
            <v-btn
              v-else
              size="small"
              variant="text"
              prepend-icon="mdi-plus"
              @click="onAddKnownGate(gate)"
            >
              {{ $t('hardware.add') }}
            </v-btn>
            <v-menu>
              <template #activator="{ props: menu }">
                <v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  size="small"
                  variant="text"
                  :aria-label="$t('common.moreFor', { name: gate.id })"
                />
              </template>
              <v-list density="compact">
                <v-list-item
                  prepend-icon="mdi-close"
                  :title="$t('hardware.forget')"
                  @click="onForgetKnownGate(gate.id)"
                />
              </v-list>
            </v-menu>
          </td>
        </tr>
        <tr v-if="knownGates.length === 0">
          <td colspan="3" class="rg-empty">
            {{ $t('hardware.knownEmpty') }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </v-card>

  <v-dialog :model-value="confirmingPowerOff" max-width="480" persistent>
    <v-card>
      <v-card-title>{{ $t('hardware.shutDownTitle') }}</v-card-title>
      <v-card-text v-if="!powerOffResults">
        {{ $t('hardware.shutDownText') }}
      </v-card-text>
      <v-card-text v-else>
        <div v-if="powerOffResults.length === 0">
          {{ $t('hardware.noneOnline') }}
        </div>
        <div v-for="r in powerOffResults" :key="r.gateId">
          <v-icon
            :icon="r.ok ? 'mdi-check' : 'mdi-alert'"
            :color="r.ok ? 'success' : 'error'"
            size="small"
          />
          {{ r.gateId }}:
          {{
            r.ok
              ? $t('hardware.shuttingDown')
              : r.error === 'refused'
                ? $t('hardware.powerOffRefused', { detail: r.detail })
                : $t('hardware.powerOffUnreachable')
          }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <template v-if="!powerOffResults">
          <v-btn variant="text" @click="closePowerOff">
            {{ $t('common.cancel') }}
          </v-btn>
          <v-btn color="error" :loading="poweringOff" @click="onPowerOffAll">
            {{ $t('hardware.shutDown') }}
          </v-btn>
        </template>
        <v-btn v-else variant="text" @click="closePowerOff">
          {{ $t('common.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <FormDialog
    v-model="gateDialogOpen"
    :title="$t('hardware.addGate')"
    :form="gateDraft"
    :save="onSaveGate"
    :saved="$t('hardware.added')"
    :save-text="$t('hardware.addGate')"
  >
    <v-text-field
      v-model="gateDraft.id"
      :label="$t('hardware.gateId')"
      :hint="$t('hardware.gateIdHint')"
      persistent-hint
      :rules="[required]"
      autofocus
    />
    <v-text-field
      v-model="gateDraft.name"
      :label="$t('hardware.nameOptional')"
    />
  </FormDialog>
</template>
