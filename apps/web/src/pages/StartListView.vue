<script setup lang="ts">
import { StageStatus, type StartOrderEntry } from '@rally-gate/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { rallyName } from '../api/rally-info';
import { fetchStages, type Stage } from '../api/stages';
import {
  fetchStartOrder,
  freezeStartOrder,
  unfreezeStartOrder,
  type StartOrder,
} from '../api/start-order';

const props = defineProps<{ stageId?: string }>();
const router = useRouter();

const stages = ref<Stage[]>([]);
const startOrder = ref<StartOrder | null>(null);

const stageOptions = computed(() =>
  stages.value.map((s) => ({ id: s.id, title: `${s.stageNumber}. ${s.name}` })),
);
const stage = computed(() => stages.value.find((s) => s.id === props.stageId));

/** The stage a marshal most likely wants: running, else next up. */
function defaultStage(): Stage | undefined {
  return (
    stages.value.find((s) => s.status === StageStatus.ACTIVE) ??
    stages.value.find((s) => s.status === StageStatus.NOT_STARTED) ??
    stages.value.at(-1)
  );
}

async function refresh() {
  startOrder.value = props.stageId
    ? await fetchStartOrder(props.stageId)
    : null;
}

/**
 * Consecutive entries of one class. A frozen list has late entries appended
 * after the last class, so the same class can show up again at the end.
 */
const groups = computed(() => {
  const order = startOrder.value;
  if (!order) return [];
  if (!order.grouped) return [{ name: null, entries: order.entries }];
  const result: { name: string | null; entries: StartOrderEntry[] }[] = [];
  for (const entry of order.entries) {
    const last = result.at(-1);
    if (last && last.name === entry.mainClassName) last.entries.push(entry);
    else result.push({ name: entry.mainClassName, entries: [entry] });
  }
  return result;
});

/** With the day: a list is often posted the evening before. */
const frozenAt = computed(() =>
  startOrder.value?.frozenAt
    ? new Date(startOrder.value.frozenAt).toLocaleString([], {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null,
);

async function onFreeze() {
  if (!props.stageId) return;
  try {
    startOrder.value = await freezeStartOrder(props.stageId);
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to freeze');
  }
}

async function onUnfreeze() {
  if (!props.stageId) return;
  if (
    !confirm(
      'Unfreeze this start list? It is computed live again, so a posted copy may stop matching it.',
    )
  )
    return;
  try {
    startOrder.value = await unfreezeStartOrder(props.stageId);
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to unfreeze');
  }
}

function print() {
  window.print();
}

function onSelectStage(stageId: string) {
  router.push(`/start-list/${stageId}`);
}

watch(() => props.stageId, refresh);

onMounted(async () => {
  stages.value = await fetchStages();
  if (!props.stageId) {
    const fallback = defaultStage();
    if (fallback) router.replace(`/start-list/${fallback.id}`);
    return;
  }
  await refresh();
});
</script>

<template>
  <v-card>
    <v-card-item>
      <v-card-title>
        Start list<template v-if="stage">
          — {{ stage.stageNumber }}. {{ stage.name }}</template
        >
      </v-card-title>
      <v-card-subtitle>
        {{ rallyName
        }}<template v-if="startOrder">
          ·
          {{
            startOrder.frozen ? `Published ${frozenAt}` : 'Provisional'
          }}</template
        >
      </v-card-subtitle>
      <template #append>
        <div class="d-flex ga-2 d-print-none">
          <v-btn
            v-if="startOrder && !startOrder.frozen"
            color="primary"
            prepend-icon="mdi-lock"
            @click="onFreeze"
          >
            Freeze
          </v-btn>
          <v-btn
            v-if="
              startOrder?.frozen && stage?.status === StageStatus.NOT_STARTED
            "
            variant="text"
            prepend-icon="mdi-lock-open-variant"
            @click="onUnfreeze"
          >
            Unfreeze
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-printer"
            :disabled="!startOrder"
            @click="print"
          >
            Print
          </v-btn>
        </div>
      </template>
    </v-card-item>
    <v-card-text class="d-print-none">
      <v-select
        :model-value="props.stageId"
        :items="stageOptions"
        item-value="id"
        item-title="title"
        label="Stage"
        density="comfortable"
        hide-details
        class="mb-4"
        style="max-width: 320px"
        @update:model-value="onSelectStage"
      />
      <v-alert
        v-if="startOrder && !startOrder.frozen"
        type="info"
        variant="tonal"
        density="comfortable"
        class="mb-4"
      >
        Computed live, so a time correction on an earlier stage can still move
        it. <strong>Freeze it when you post or announce it</strong> — activating
        the stage freezes it otherwise. Order rules are under
        <router-link to="/setup/start-order">Setup → Start order</router-link>.
      </v-alert>
      <v-alert
        v-if="stages.length === 0"
        type="info"
        variant="tonal"
        density="comfortable"
      >
        No stages yet.
      </v-alert>
    </v-card-text>
  </v-card>

  <v-card
    v-for="group in groups"
    :key="group.name ?? ''"
    class="mt-4 rg-start-group"
  >
    <v-card-item v-if="startOrder?.grouped">
      <v-card-title class="d-flex align-center ga-2">
        {{ group.name ?? 'No main class' }}
        <v-chip size="small" variant="tonal">
          {{ group.entries.length }}
        </v-chip>
      </v-card-title>
    </v-card-item>
    <v-card-text>
      <v-table density="comfortable">
        <colgroup>
          <col style="width: 80px" />
          <col style="width: 100px" />
          <col />
          <col />
          <col v-if="!startOrder?.grouped" style="width: 140px" />
        </colgroup>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Start #</th>
            <th>Driver</th>
            <th>Co-driver</th>
            <th v-if="!startOrder?.grouped">Class</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in group.entries" :key="entry.vehicleId">
            <td class="rg-timing">{{ entry.position }}</td>
            <td class="rg-timing font-weight-bold">{{ entry.startNumber }}</td>
            <td>{{ entry.driverName }}</td>
            <td>{{ entry.coDriverName }}</td>
            <td v-if="!startOrder?.grouped">{{ entry.mainClassName }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>

<style scoped>
/* Fixed layout, so the per-class tables line up column by column. */
.rg-start-group :deep(table) {
  table-layout: fixed;
}
/* A class heading never ends a page on its own. */
.rg-start-group :deep(.v-card-item) {
  break-after: avoid;
}
</style>
