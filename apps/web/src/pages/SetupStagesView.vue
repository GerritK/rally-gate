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
import { required, STAGE_STATUS_DISPLAY } from '../format';
import { notify, useConfirm } from '@rally-gate/ui';

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
      title: `Delete stage ${stage.id}?`,
      text: 'Its gate assignments go with it.',
      confirmText: 'Delete stage',
      color: 'error',
    }))
  )
    return;
  await deleteStage(stage.id);
  await refresh();
  notify('Stage deleted');
}

onMounted(refresh);
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title class="d-flex align-center">
      Stages
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">
        Add Stage
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-table density="comfortable" hover>
        <thead>
          <tr>
            <th>#</th>
            <th>ID</th>
            <th>Name</th>
            <th>Status</th>
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
              <v-chip
                size="small"
                :color="STAGE_STATUS_DISPLAY[stage.status].color"
                :prepend-icon="STAGE_STATUS_DISPLAY[stage.status].icon"
              >
                {{ STAGE_STATUS_DISPLAY[stage.status].label }}
              </v-chip>
            </td>
            <td class="text-no-wrap">
              <v-menu v-if="stage.status === StageStatus.NOT_STARTED">
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    size="small"
                    variant="text"
                    :aria-label="`More for ${stage.id}`"
                    @click.stop
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    title="Delete"
                    base-color="error"
                    @click="onDeleteStage(stage)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr v-if="stages.length === 0">
            <td colspan="5" class="rg-empty">
              No stages yet. Add one with + Add Stage.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="dialogOpen"
    title="Add stage"
    :form="draft"
    :save="onCreate"
    saved="Stage added"
    save-text="Add stage"
  >
    <v-text-field
      v-model.number="draft.stageNumber"
      type="number"
      min="1"
      label="Stage #"
      :rules="[required]"
    />
    <v-text-field
      v-model="draft.id"
      label="ID"
      hint="The organiser's own code, e.g. WP3. Can't be changed later."
      persistent-hint
      :rules="[required]"
      autofocus
    />
    <v-text-field v-model="draft.name" label="Name" :rules="[required]" />
  </FormDialog>
</template>
