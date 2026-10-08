<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchEntries, type Entry } from '../api/entries';
import { fetchEntryClasses, type EntryClass } from '../api/entry-classes';
import ClassChip from '../components/ClassChip.vue';
import CrewName from '../components/CrewName.vue';
import StartNumber from '../components/StartNumber.vue';
import EntryDialog from '../components/EntryDialog.vue';
import EntryStatusActions from '../components/EntryStatusActions.vue';
import { ENTRY_STATUS_DISPLAY } from '../format';
import { formatTransponders } from '../entry-status';

const router = useRouter();
const entries = ref<Entry[]>([]);
const classes = ref<EntryClass[]>([]);
const dialogOpen = ref(false);

/** In the order of the class list (main first, then by name), which the
 * server sorts; an entry's own classes come back in no particular order. */
function classesOf(entry: Entry): EntryClass[] {
  return classes.value.filter((c) =>
    entry.classes.some((own) => own.id === c.id),
  );
}

function replace(saved: Entry) {
  entries.value = entries.value.map((v) => (v.id === saved.id ? saved : v));
}

async function refresh() {
  entries.value = await fetchEntries();
  classes.value = await fetchEntryClasses();
}

onMounted(refresh);
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      Entries
      <v-spacer />
      <div class="d-flex flex-wrap justify-end ga-2">
        <v-btn
          variant="tonal"
          prepend-icon="mdi-clipboard-check-outline"
          to="/entries/check-in"
        >
          Check-in
        </v-btn>
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          @click="dialogOpen = true"
        >
          Add Entry
        </v-btn>
      </div>
    </v-card-title>
    <v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>#</th>
            <th>Crew</th>
            <th>Car</th>
            <!-- Off a tablet's width, so the status actions stay on screen; the
                 entry page and Check-in show it. -->
            <th class="d-none d-md-table-cell">Transponder</th>
            <th v-if="classes.length > 0">Classes</th>
            <th>Status</th>
            <th width="1%"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
            class="cursor-pointer"
            @click="router.push(`/entries/${entry.id}`)"
          >
            <td><StartNumber :number="entry.startNumber" /></td>
            <td><CrewName :crew="entry" /></td>
            <td>{{ entry.body ?? '-' }}</td>
            <td class="rg-timing d-none d-md-table-cell">
              {{ formatTransponders(entry) ?? '-' }}
            </td>
            <td v-if="classes.length > 0">
              <ClassChip
                v-for="c in classesOf(entry)"
                :key="c.id"
                :name="c.name"
                :main="c.main"
                class="me-1"
              />
            </td>
            <td>
              <v-chip
                size="small"
                :color="ENTRY_STATUS_DISPLAY[entry.status].color"
                :prepend-icon="ENTRY_STATUS_DISPLAY[entry.status].icon"
              >
                {{ ENTRY_STATUS_DISPLAY[entry.status].label }}
              </v-chip>
            </td>
            <td class="text-no-wrap text-right">
              <EntryStatusActions :entry="entry" @saved="replace" />
            </td>
          </tr>
          <tr v-if="entries.length === 0">
            <td colspan="7" class="rg-empty">
              No entries yet. Add one with + Add Entry.
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>

  <EntryDialog
    v-model="dialogOpen"
    :entry="null"
    :classes="classes"
    :entries="entries"
    @saved="refresh"
  />
</template>
