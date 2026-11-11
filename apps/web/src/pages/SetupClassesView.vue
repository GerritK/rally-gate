<script setup lang="ts">
import { useLoad } from '../load';
import EmptyRow from '../components/EmptyRow.vue';
import LoadError from '../components/LoadError.vue';
import { can } from '../api/auth';
import { RallyStatus } from '@rally-gate/shared';
import { computed, ref } from 'vue';
import {
  createEntryClass,
  deleteEntryClass,
  fetchEntryClasses,
  updateEntryClass,
  type EntryClass,
} from '../api/entry-classes';
import { fetchEntries, type Entry } from '../api/entries';
import FormDialog from '../components/FormDialog.vue';
import { lockedWhen } from '../api/rally-info';
import RallyLockAlert from '../components/RallyLockAlert.vue';
import { required } from '../format';
import { notify, t, useConfirm } from '@rally-gate/ui';

const confirm = useConfirm();
// Renaming or deleting regroups rankings already timed; adding doesn't.
const editLocked = lockedWhen(RallyStatus.RUNNING, RallyStatus.CLOSED);
const addLocked = lockedWhen(RallyStatus.CLOSED);

const classes = ref<EntryClass[]>([]);
const entries = ref<Entry[]>([]);

const dialogOpen = ref(false);
const editing = ref<EntryClass | null>(null);
const draft = ref({ name: '', main: false });

const entryCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const entry of entries.value) {
    for (const c of entry.classes) {
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
  }
  return counts;
});
const countOf = (entryClass: EntryClass) =>
  entryCounts.value.get(entryClass.id) ?? 0;

async function refresh() {
  [classes.value, entries.value] = await Promise.all([
    fetchEntryClasses(),
    fetchEntries(),
  ]);
}

function openDialog(entryClass: EntryClass | null) {
  editing.value = entryClass;
  draft.value = {
    name: entryClass?.name ?? '',
    main: entryClass?.main ?? false,
  };
  dialogOpen.value = true;
}

async function onSave() {
  const input = { name: draft.value.name.trim(), main: draft.value.main };
  if (editing.value) await updateEntryClass(editing.value.id, input);
  else await createEntryClass(input);
  await refresh();
}

async function onDeleteClass(entryClass: EntryClass) {
  const count = countOf(entryClass);
  if (
    !(await confirm({
      title: t('classes.deleteTitle', { name: entryClass.name }),
      text:
        count > 0
          ? t('classes.deleteText', { n: count }, count)
          : t('classes.deleteEmpty'),
      confirmText: t('classes.delete'),
      color: 'error',
    }))
  )
    return;
  await deleteEntryClass(entryClass.id);
  await refresh();
  notify(t('classes.deleted'));
}

const load = useLoad(refresh);
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    {{ $t('setup.back') }}
  </v-btn>

  <LoadError :load="load" />
  <RallyLockAlert :when="[RallyStatus.RUNNING, RallyStatus.CLOSED]" />
  <v-card>
    <v-card-item>
      <v-card-title>{{ $t('classes.classes') }}</v-card-title>
      <template #append>
        <div class="d-flex flex-wrap justify-end ga-2">
          <v-btn
            v-if="can('setup')"
            variant="tonal"
            prepend-icon="mdi-plus"
            :disabled="addLocked"
            @click="openDialog(null)"
          >
            {{ $t('classes.add') }}
          </v-btn>
        </div>
      </template>
    </v-card-item>
    <v-card-text>
      <p class="mb-4">
        <i18n-t keypath="classes.explain" scope="global">
          <template #mainClasses>
            <strong>{{ $t('classes.mainClasses') }}</strong>
          </template>
          <template #categories>
            <strong>{{ $t('classes.categories') }}</strong>
          </template>
        </i18n-t>
      </p>
      <v-table v-key-scroll density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('stages.name') }}</th>
            <th>{{ $t('transponder.kind') }}</th>
            <th>{{ $t('nav.entries') }}</th>
            <th v-if="can('setup')" width="1%">
              <span class="d-sr-only">{{ $t('table.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entryClass in classes" :key="entryClass.id">
            <td>{{ entryClass.name }}</td>
            <td>
              <v-chip
                size="small"
                :color="entryClass.main ? 'secondary' : undefined"
                :prepend-icon="entryClass.main ? 'mdi-star' : 'mdi-tag'"
              >
                {{
                  entryClass.main
                    ? $t('classes.mainClass')
                    : $t('classes.category')
                }}
              </v-chip>
            </td>
            <td>{{ countOf(entryClass) }}</td>
            <td v-if="can('setup')" class="text-no-wrap">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                :disabled="editLocked"
                @click="openDialog(entryClass)"
              >
                {{ $t('common.edit') }}
              </v-btn>
              <v-menu>
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    :disabled="editLocked"
                    size="small"
                    variant="text"
                    :aria-label="
                      $t('common.moreFor', { name: entryClass.name })
                    "
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    :title="$t('common.delete')"
                    base-color="error"
                    @click="onDeleteClass(entryClass)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <EmptyRow :load="load" :empty="classes.length === 0" :colspan="4">
            {{ $t('classes.empty', { action: $t('classes.add') }) }}
          </EmptyRow>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="dialogOpen"
    :title="
      editing
        ? $t('classes.editTitle', { name: editing.name })
        : $t('classes.add')
    "
    :form="draft"
    :save="onSave"
    :saved="editing ? $t('classes.saved') : $t('classes.added')"
    :save-text="editing ? $t('common.save') : $t('classes.add')"
  >
    <v-text-field
      v-model="draft.name"
      :label="$t('stages.name')"
      :rules="[required]"
      autofocus
    />
    <v-switch
      v-model="draft.main"
      :label="$t('classes.mainSwitch')"
      color="secondary"
      hide-details
    />
  </FormDialog>
</template>
