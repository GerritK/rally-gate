<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { StageStatus } from '@rally-gate/shared';
import {
  createStage,
  deleteStage,
  fetchStages,
  type Stage,
} from '../api/stages';
import FormDialog from '../components/FormDialog.vue';
import StatusChip from '../components/StatusChip.vue';
import { required, STAGE_STATUS_DISPLAY } from '../format';
import { notify, t, useConfirm } from '@rally-gate/ui';

const confirm = useConfirm();
const router = useRouter();

const stages = ref<Stage[]>([]);
const dialogOpen = ref(false);
const draft = ref({ id: '', name: '', stageNumber: 1 });

async function refresh() {
  stages.value = await fetchStages();
}

function openCreate() {
  draft.value = {
    id: '',
    name: '',
    stageNumber: Math.max(0, ...stages.value.map((s) => s.stageNumber)) + 1,
  };
  dialogOpen.value = true;
}

/** Only the required fields here; the rest, gates included, is set on the
 *  detail page it opens. */
async function onCreate() {
  const stage = await createStage({
    id: draft.value.id.trim(),
    name: draft.value.name.trim(),
    stageNumber: Number(draft.value.stageNumber),
  });
  await router.push(`/setup/stages/${stage.id}`);
}

async function onDeleteStage(stage: Stage) {
  if (
    !(await confirm({
      title: t('stages.deleteTitle', { id: stage.id }),
      text: t('stages.deleteText'),
      confirmText: t('stages.delete'),
      color: 'error',
    }))
  )
    return;
  await deleteStage(stage.id);
  await refresh();
  notify(t('stages.deleted'));
}

onMounted(refresh);
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    {{ $t('setup.back') }}
  </v-btn>

  <v-card>
    <v-card-title class="d-flex align-center">
      {{ $t('stages.title') }}
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">
        {{ $t('stages.add') }}
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-table density="comfortable" hover>
        <thead>
          <tr>
            <th>#</th>
            <th>{{ $t('stages.id') }}</th>
            <th>{{ $t('stages.name') }}</th>
            <th>{{ $t('table.status') }}</th>
            <th width="1%"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="stage in stages"
            :key="stage.id"
            class="cursor-pointer"
            @click="router.push(`/setup/stages/${stage.id}`)"
          >
            <td>{{ stage.stageNumber }}</td>
            <td>{{ stage.id }}</td>
            <td>{{ stage.name }}</td>
            <td>
              <StatusChip :display="STAGE_STATUS_DISPLAY[stage.status]" />
            </td>
            <td class="text-no-wrap">
              <v-menu v-if="stage.status === StageStatus.NOT_STARTED">
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    size="small"
                    variant="text"
                    :aria-label="$t('common.moreFor', { name: stage.id })"
                    @click.stop
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    :title="$t('common.delete')"
                    base-color="error"
                    @click="onDeleteStage(stage)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr v-if="stages.length === 0">
            <td colspan="5" class="rg-empty">
              {{ $t('stages.empty', { action: $t('stages.add') }) }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="dialogOpen"
    :title="$t('stages.add')"
    :form="draft"
    :save="onCreate"
    :saved="$t('stages.added')"
    :save-text="$t('stages.add')"
  >
    <v-text-field
      v-model.number="draft.stageNumber"
      type="number"
      min="1"
      :label="$t('stages.number')"
      :rules="[required]"
    />
    <v-text-field
      v-model="draft.id"
      :label="$t('stages.id')"
      :hint="$t('stages.idHint')"
      persistent-hint
      :rules="[required]"
      autofocus
    />
    <v-text-field
      v-model="draft.name"
      :label="$t('stages.name')"
      :rules="[required]"
    />
  </FormDialog>
</template>
