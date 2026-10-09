<script setup lang="ts">
import {
  DEFAULT_NOTIONAL_PENALTY_MS,
  NOTIONAL_PENALTY_MS_KEY,
  PenaltyScope,
  type PenaltyTier,
} from '@rally-gate/shared';
import { onMounted, ref } from 'vue';
import {
  createPenaltyType,
  deletePenaltyType,
  fetchPenaltyTypes,
  updatePenaltyType,
  type PenaltyType,
} from '../api/penalties';
import { fetchSetting, saveSetting } from '../api/settings';
import FormDialog from '../components/FormDialog.vue';
import {
  formatWholeSeconds,
  parseWholeSeconds,
  required,
  wholeSeconds,
} from '../format';
import { useUnsavedChanges } from '../unsaved-changes';
import { notify, t, useConfirm } from '@rally-gate/ui';

const confirm = useConfirm();

const types = ref<PenaltyType[]>([]);
const dialogOpen = ref(false);
const editing = ref<PenaltyType | null>(null);
const draft = ref({
  name: '',
  scope: PenaltyScope.STAGE,
  /** `seconds` as typed (`0:30`), parsed on save. */
  tiers: [] as { fromCount: number; seconds: string }[],
});

const scopeItems = [
  { value: PenaltyScope.STAGE, key: 'penalties.perStage' },
  { value: PenaltyScope.RALLY, key: 'penalties.perRally' },
] as const;

const positive = (value: unknown) =>
  (Number.isInteger(value) && (value as number) > 0) ||
  t('penalties.wholePositive');

function formatTiers(tiers: PenaltyTier[]): string {
  if (tiers.length === 1) {
    return t('penalties.perOffence', {
      time: formatWholeSeconds(tiers[0].seconds),
    });
  }
  return tiers
    .map((tier) =>
      t('penalties.tierFrom', {
        n: tier.fromCount,
        time: formatWholeSeconds(tier.seconds),
      }),
    )
    .join(' · ');
}

function openDialog(type: PenaltyType | null) {
  editing.value = type;
  draft.value = {
    name: type?.name ?? '',
    scope: type?.scope ?? PenaltyScope.STAGE,
    tiers: type
      ? type.tiers.map((tier) => ({
          fromCount: tier.fromCount,
          seconds: formatWholeSeconds(tier.seconds),
        }))
      : [{ fromCount: 1, seconds: '0:10' }],
  };
  dialogOpen.value = true;
}

function addTier() {
  const last = draft.value.tiers.at(-1)!;
  draft.value.tiers.push({
    fromCount: last.fromCount + 1,
    seconds: last.seconds,
  });
}

async function onSaveType() {
  const input = {
    ...draft.value,
    name: draft.value.name.trim(),
    tiers: draft.value.tiers.map((tier) => ({
      fromCount: tier.fromCount,
      seconds: parseWholeSeconds(tier.seconds)!,
    })),
  };
  if (editing.value) await updatePenaltyType(editing.value.id, input);
  else await createPenaltyType(input);
  types.value = await fetchPenaltyTypes();
}

async function onDeleteType(type: PenaltyType) {
  if (
    !(await confirm({
      title: t('penalties.deleteTitle', { name: type.name }),
      text: t('penalties.deleteText'),
      confirmText: t('penalties.deleteTypeConfirm'),
      color: 'error',
    }))
  )
    return;
  await deletePenaltyType(type.id);
  types.value = await fetchPenaltyTypes();
  notify(t('penalties.typeDeleted'));
}

const notionalPenalty = ref(
  formatWholeSeconds(DEFAULT_NOTIONAL_PENALTY_MS / 1000),
);
const savingPenalty = ref(false);
const { markSaved } = useUnsavedChanges(() => notionalPenalty.value);

async function onSavePenalty() {
  const seconds = parseWholeSeconds(notionalPenalty.value);
  if (savingPenalty.value || seconds === null) return;
  savingPenalty.value = true;
  try {
    await saveSetting(NOTIONAL_PENALTY_MS_KEY, String(seconds * 1000));
    markSaved();
    notify(t('scoring.saved'));
  } finally {
    savingPenalty.value = false;
  }
}

onMounted(async () => {
  types.value = await fetchPenaltyTypes();
  const storedMs = Number(await fetchSetting(NOTIONAL_PENALTY_MS_KEY));
  if (Number.isFinite(storedMs) && storedMs > 0) {
    notionalPenalty.value = formatWholeSeconds(Math.round(storedMs / 1000));
  }
  markSaved();
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    {{ $t('setup.back') }}
  </v-btn>

  <v-card>
    <v-card-title>{{ $t('scoring.title') }}</v-card-title>
    <v-card-text>
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-4">
        <i18n-t keypath="scoring.explain" tag="p" scope="global">
          <template #notionalTime>
            <strong>{{ $t('scoring.notionalTime') }}</strong>
          </template>
        </i18n-t>
        <i18n-t
          keypath="scoring.ruleOfThumb"
          tag="p"
          scope="global"
          class="mt-2"
        >
          <template #oneStage>
            <strong>{{ $t('scoring.oneStage') }}</strong>
          </template>
        </i18n-t>
      </v-alert>
      <form
        class="d-flex flex-wrap align-center ga-3"
        @submit.prevent="onSavePenalty"
      >
        <v-text-field
          v-model="notionalPenalty"
          :label="$t('scoring.penaltyLabel')"
          :rules="[wholeSeconds]"
          placeholder="2:00"
          density="comfortable"
          hide-details="auto"
          style="max-width: 260px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="savingPenalty"
          prepend-icon="mdi-content-save"
        >
          {{ $t('common.save') }}
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-card class="mt-4">
    <v-card-title class="d-flex align-center">
      {{ $t('penalties.catalogue') }}
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-plus" @click="openDialog(null)">
        {{ $t('penalties.addType') }}
      </v-btn>
    </v-card-title>
    <v-card-text>
      <p class="mb-4">{{ $t('penalties.explain') }}</p>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('stages.name') }}</th>
            <th>{{ $t('penalties.price') }}</th>
            <th>{{ $t('penalties.counted') }}</th>
            <th width="1%"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="type in types" :key="type.id">
            <td>{{ type.name }}</td>
            <td>{{ formatTiers(type.tiers) }}</td>
            <!-- Only tiers count offences; a flat price has nothing to count. -->
            <td>
              {{
                type.tiers.length > 1
                  ? $t(scopeItems.find((s) => s.value === type.scope)!.key)
                  : '-'
              }}
            </td>
            <td class="text-no-wrap">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="openDialog(type)"
              >
                {{ $t('common.edit') }}
              </v-btn>
              <v-menu>
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    size="small"
                    variant="text"
                    :aria-label="$t('common.moreFor', { name: type.name })"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    :title="$t('common.delete')"
                    base-color="error"
                    @click="onDeleteType(type)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr v-if="types.length === 0">
            <td colspan="4" class="rg-empty">
              {{
                $t('penalties.emptyCatalogue', {
                  action: $t('penalties.addType'),
                })
              }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="dialogOpen"
    :title="
      editing
        ? $t('penalties.editTitle', { name: editing.name })
        : $t('penalties.addType')
    "
    :form="draft"
    :save="onSaveType"
    :saved="$t('penalties.typeSaved')"
    :save-text="editing ? $t('common.save') : $t('penalties.addType')"
  >
    <v-text-field
      v-model="draft.name"
      :label="$t('stages.name')"
      :rules="[required]"
      autofocus
    />
    <div v-for="(tier, index) in draft.tiers" :key="index" class="d-flex ga-3">
      <v-text-field
        v-model.number="tier.fromCount"
        class="flex-1-1-0"
        type="number"
        min="1"
        step="1"
        :label="$t('penalties.fromOffence')"
        :rules="[positive]"
        :disabled="index === 0"
      />
      <v-text-field
        v-model="tier.seconds"
        class="flex-1-1-0"
        :label="$t('penalties.time')"
        :rules="[wholeSeconds]"
        placeholder="0:30"
      />
      <v-btn
        icon="mdi-close"
        variant="text"
        :disabled="index === 0"
        :aria-label="$t('penalties.removeTier')"
        @click="draft.tiers.splice(index, 1)"
      />
    </div>
    <div>
      <v-btn variant="text" prepend-icon="mdi-plus" @click="addTier">
        {{ $t('penalties.addTier') }}
      </v-btn>
    </div>
    <v-select
      v-if="draft.tiers.length > 1"
      v-model="draft.scope"
      :items="scopeItems.map((s) => ({ value: s.value, title: $t(s.key) }))"
      :label="$t('penalties.counted')"
      :hint="$t('penalties.countedHint')"
      persistent-hint
    />
  </FormDialog>
</template>
