<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  createEntryClass,
  deleteEntryClass,
  fetchEntryClasses,
  updateEntryClass,
  type EntryClass,
} from '../api/entry-classes';
import { fetchEntries, type Entry } from '../api/entries';
import FormDialog from '../components/FormDialog.vue';
import { required } from '../format';
import { notify, useConfirm } from '@rally-gate/ui';

const confirm = useConfirm();

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
  classes.value = await fetchEntryClasses();
  entries.value = await fetchEntries();
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
      title: `Delete class "${entryClass.name}"?`,
      text:
        count > 0
          ? `${count} entry${count === 1 ? '' : 's'} will leave it; the entries themselves are kept.`
          : 'No entry is in it.',
      confirmText: 'Delete class',
      color: 'error',
    }))
  )
    return;
  await deleteEntryClass(entryClass.id);
  await refresh();
  notify('Class deleted');
}

onMounted(refresh);
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    Back to Setup
  </v-btn>

  <v-card>
    <v-card-title class="d-flex align-center">
      Classes
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-plus" @click="openDialog(null)">
        Add Class
      </v-btn>
    </v-card-title>
    <v-card-text>
      <p class="mb-4">
        <strong>Main classes</strong> (4WD, 2WD) split the field — an entry has
        one. <strong>Categories</strong> (Rookie, Stock) cut across them — a
        entry has any number. Results combine any of them, e.g. Stock Rookie
        2WD, with positions, gaps and notional times computed within that group.
        Assign them on the Entries page; the overall ranking always includes
        everyone.
      </p>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Entries</th>
            <th width="1%"></th>
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
                {{ entryClass.main ? 'Main class' : 'Category' }}
              </v-chip>
            </td>
            <td>{{ countOf(entryClass) }}</td>
            <td class="text-no-wrap">
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="openDialog(entryClass)"
              >
                Edit
              </v-btn>
              <v-menu>
                <template #activator="{ props: menu }">
                  <v-btn
                    v-bind="menu"
                    icon="mdi-dots-vertical"
                    size="small"
                    variant="text"
                    :aria-label="`More for ${entryClass.name}`"
                  />
                </template>
                <v-list density="compact">
                  <v-list-item
                    prepend-icon="mdi-delete-outline"
                    title="Delete"
                    base-color="error"
                    @click="onDeleteClass(entryClass)"
                  />
                </v-list>
              </v-menu>
            </td>
          </tr>
          <tr v-if="classes.length === 0">
            <td colspan="4" class="rg-empty">
              No classes yet. Without any, results are one overall ranking. Add
              one with + Add Class.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <FormDialog
    v-model="dialogOpen"
    :title="editing ? `Edit class ${editing.name}` : 'Add class'"
    :form="draft"
    :save="onSave"
    :saved="editing ? 'Class saved' : 'Class added'"
    :save-text="editing ? 'Save' : 'Add class'"
  >
    <v-text-field
      v-model="draft.name"
      label="Name"
      :rules="[required]"
      autofocus
    />
    <v-switch
      v-model="draft.main"
      label="Main class (an entry has one)"
      color="secondary"
      hide-details
    />
  </FormDialog>
</template>
