<script setup lang="ts">
import { RallyStatus, StageStatus } from '@rally-gate/shared';
import { onMounted, ref } from 'vue';
import {
  createEvent,
  fetchEventInfo,
  openEvent,
  waitForEvent,
  type EventInfo,
} from '../api/event';
import { fetchEntries } from '../api/entries';
import { fetchEntryClasses } from '../api/entry-classes';
import { fetchGateAssignments } from '../api/gate-assignments';
import { fetchGates } from '../api/gates';
import {
  changeRallyStatus,
  fetchRallyInfo,
  rallyStatus,
  saveRallyInfo,
  type RallyInfo,
} from '../api/rally-info';
import { fetchStages } from '../api/stages';
import { serverNow } from '../api/time';
import FormDialog from '../components/FormDialog.vue';
import StatusChip from '../components/StatusChip.vue';
import {
  eventName,
  isOnline,
  isReady,
  RALLY_STATUS_DISPLAY,
  required,
} from '../format';
import { preStartCheck, type CheckFinding } from '../pre-start-check';
import { useUnsavedChanges } from '../unsaved-changes';
import { currentLocale, notify, t, useConfirm } from '@rally-gate/ui';

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const rallyInfo = ref<RallyInfo>({ name: '', date: '', location: '' });
const saving = ref(false);
const eventInfo = ref<EventInfo | null>(null);
const newDialog = ref(false);
const openDialog = ref(false);
const newEvent = ref({ name: '', date: today() });
const switchingTo = ref<string | null>(null);
const { markSaved } = useUnsavedChanges(() => rallyInfo.value);
const confirm = useConfirm();
/** Null until Start rally is pressed: the check runs on the data as it is
 *  then, not as it was when the page opened. */
const findings = ref<CheckFinding[] | null>(null);
const changing = ref(false);

async function changeStatus(
  action: 'start' | 'close' | 'reopen',
  done: string,
) {
  changing.value = true;
  try {
    await changeRallyStatus(action);
    findings.value = null;
    notify(t(done));
  } finally {
    changing.value = false;
  }
}

async function onStart() {
  const [stages, assignments, gates, entries, classes] = await Promise.all([
    fetchStages(),
    fetchGateAssignments(),
    fetchGates(),
    fetchEntries(),
    fetchEntryClasses(),
  ]);
  findings.value = preStartCheck({
    stages,
    assignments,
    gates: gates.map((g) => ({
      id: g.id,
      name: g.name,
      online: isOnline(g, serverNow.value),
      ready: isReady(g, serverNow.value),
    })),
    entries,
    anyClass: classes.length > 0,
  });
}

/** Names the stages it closes; the server refuses while a car is on one. */
async function onClose() {
  const open = (await fetchStages())
    .filter((s) => s.status === StageStatus.ACTIVE)
    .map((s) => s.id);
  const ok = await confirm({
    title: t('rally.closeTitle'),
    text: [
      open.length > 0 && t('rally.closesStages', { stages: open.join(', ') }),
      t('rally.closeText'),
    ]
      .filter(Boolean)
      .join(' '),
    confirmText: t('rally.close'),
    color: 'error',
  });
  if (ok) return changeStatus('close', 'rally.closedNotice');
}

async function onReopen() {
  const ok = await confirm({
    title: t('rally.reopenTitle'),
    text: t('rally.reopenText'),
    confirmText: t('rally.reopen'),
  });
  if (ok) return changeStatus('reopen', 'rally.reopenedNotice');
}

async function onSave() {
  if (!rallyInfo.value.name || saving.value) return;
  saving.value = true;
  try {
    rallyInfo.value = await saveRallyInfo(rallyInfo.value);
    markSaved();
    notify(t('setup.rallySaved'));
  } finally {
    saving.value = false;
  }
}

/** Reloads the whole app afterwards: every page holds the old event's data. */
async function switchEvent(request: () => Promise<{ file: string }>) {
  const { file } = await request();
  switchingTo.value = file;
  try {
    await waitForEvent(file);
  } catch (err) {
    switchingTo.value = null;
    throw err;
  }
  location.reload();
}

function openNew() {
  newEvent.value = { name: '', date: today() };
  newDialog.value = true;
}

function onOpen(file: string) {
  openDialog.value = false;
  return switchEvent(() => openEvent(file));
}

onMounted(async () => {
  const existing = await fetchRallyInfo();
  if (existing) rallyInfo.value = existing;
  markSaved();
  eventInfo.value = await fetchEventInfo();
});
</script>

<template>
  <v-card class="mb-6">
    <v-card-item>
      <v-card-title>{{ $t('setup.event') }}</v-card-title>
      <v-card-subtitle v-if="eventInfo">
        <v-icon icon="mdi-file-outline" size="small" />
        {{ eventInfo.file }}
      </v-card-subtitle>
      <template v-if="eventInfo?.switchable" #append>
        <v-btn variant="text" prepend-icon="mdi-plus" @click="openNew">
          {{ $t('setup.newEvent') }}
        </v-btn>
        <v-btn
          variant="text"
          prepend-icon="mdi-folder-open-outline"
          @click="openDialog = true"
        >
          {{ $t('setup.openEvent') }}
        </v-btn>
      </template>
    </v-card-item>
    <v-card-text>
      <form class="d-flex flex-wrap align-center ga-3" @submit.prevent="onSave">
        <v-text-field
          v-model="rallyInfo.name"
          :label="$t('setup.rallyName')"
          density="comfortable"
          hide-details
          style="min-width: 260px"
        />
        <v-text-field
          v-model="rallyInfo.date"
          :label="$t('setup.dateOptional')"
          density="comfortable"
          hide-details
          style="min-width: 180px"
        />
        <v-text-field
          v-model="rallyInfo.location"
          :label="$t('setup.locationOptional')"
          density="comfortable"
          hide-details
          style="min-width: 220px"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="saving"
          prepend-icon="mdi-content-save"
        >
          {{ $t('common.save') }}
        </v-btn>
      </form>
    </v-card-text>
  </v-card>

  <v-card class="mb-6">
    <v-card-item>
      <v-card-title>{{ $t('rally.title') }}</v-card-title>
      <template #append>
        <StatusChip :display="RALLY_STATUS_DISPLAY[rallyStatus]" />
        <v-menu v-if="rallyStatus === RallyStatus.CLOSED">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              icon="mdi-dots-vertical"
              variant="text"
              size="small"
              class="ml-2"
              :aria-label="$t('common.moreActions')"
            />
          </template>
          <v-list density="compact">
            <v-list-item
              prepend-icon="mdi-lock-open-variant-outline"
              :title="$t('rally.reopen')"
              @click="onReopen"
            />
          </v-list>
        </v-menu>
      </template>
    </v-card-item>
    <v-card-text class="d-flex flex-wrap align-center ga-4">
      <span class="flex-1-1">{{ $t(`rally.hint.${rallyStatus}`) }}</span>
      <v-btn
        v-if="rallyStatus === RallyStatus.SETUP"
        color="success"
        variant="outlined"
        prepend-icon="mdi-play"
        @click="onStart"
      >
        {{ $t('rally.start') }}
      </v-btn>
      <v-btn
        v-else-if="rallyStatus === RallyStatus.RUNNING"
        color="error"
        variant="outlined"
        prepend-icon="mdi-flag-checkered"
        :loading="changing"
        @click="onClose"
      >
        {{ $t('rally.close') }}
      </v-btn>
    </v-card-text>
  </v-card>

  <v-dialog
    :model-value="!!findings"
    max-width="600"
    @update:model-value="findings = null"
  >
    <v-card v-if="findings" :title="$t('rally.checkTitle')">
      <v-card-text>
        <p v-if="findings.length === 0">{{ $t('rally.checkClean') }}</p>
        <v-alert
          v-for="f in findings"
          :key="f.key + JSON.stringify(f.params)"
          :type="f.error ? 'error' : 'warning'"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          {{ $t(`rally.check.${f.key}`, f.params) }}
        </v-alert>
        <p class="text-body-2 text-medium-emphasis mt-4">
          {{ $t('rally.startText') }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="findings = null">
          {{ $t('common.cancel') }}
        </v-btn>
        <v-btn
          color="success"
          variant="flat"
          :loading="changing"
          :disabled="findings.some((f) => f.error)"
          @click="changeStatus('start', 'rally.startedNotice')"
        >
          {{
            findings.length > 0 && !findings.some((f) => f.error)
              ? $t('rally.startAnyway')
              : $t('rally.start')
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-row>
    <v-col cols="12" sm="4">
      <v-card
        class="h-100"
        to="/setup/stages"
        prepend-icon="mdi-flag-checkered"
      >
        <v-card-title>{{ $t('stages.title') }}</v-card-title>
        <v-card-text>{{ $t('setup.stagesHint') }}</v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" sm="4">
      <v-card
        class="h-100"
        to="/setup/classes"
        prepend-icon="mdi-shape-outline"
      >
        <v-card-title>{{ $t('classes.classes') }}</v-card-title>
        <v-card-text>{{ $t('setup.classesHint') }}</v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" sm="4">
      <v-card
        class="h-100"
        to="/setup/start-order"
        prepend-icon="mdi-sort-numeric-ascending"
      >
        <v-card-title>{{ $t('startOrder.title') }}</v-card-title>
        <v-card-text>{{ $t('setup.startOrderHint') }}</v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" sm="4">
      <v-card
        class="h-100"
        to="/setup/scoring"
        prepend-icon="mdi-calculator-variant-outline"
      >
        <v-card-title>{{ $t('setup.scoring') }}</v-card-title>
        <v-card-text>{{ $t('setup.scoringHint') }}</v-card-text>
      </v-card>
    </v-col>
    <v-col cols="12" sm="4">
      <v-card
        class="h-100"
        to="/setup/display"
        prepend-icon="mdi-palette-outline"
      >
        <v-card-title>{{ $t('displaySetup.title') }}</v-card-title>
        <v-card-text>{{ $t('setup.displayHint') }}</v-card-text>
      </v-card>
    </v-col>
  </v-row>

  <FormDialog
    v-model="newDialog"
    :title="$t('setup.newEvent')"
    :form="newEvent"
    :save="() => switchEvent(() => createEvent(newEvent))"
    :saved="$t('setup.eventCreated')"
    :save-text="$t('setup.createAndOpen')"
  >
    <p class="text-body-2 text-medium-emphasis">
      {{ $t('setup.newEventHint') }}
    </p>
    <v-text-field
      v-model="newEvent.name"
      :label="$t('setup.rallyName')"
      :rules="[required]"
      autofocus
    />
    <v-text-field
      v-model="newEvent.date"
      type="date"
      :label="$t('setup.date')"
      :rules="[required]"
    />
  </FormDialog>

  <v-dialog v-model="openDialog" max-width="600">
    <v-card v-if="eventInfo">
      <v-card-title>{{ $t('setup.openEvent') }}</v-card-title>
      <v-card-subtitle>
        {{ $t('setup.onThisComputer', { n: eventInfo.events.length }) }}
      </v-card-subtitle>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>{{ $t('setup.event') }}</th>
            <th>{{ $t('setup.lastChanged') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in eventInfo.events" :key="event.file">
            <td>{{ eventName(event.file) }}</td>
            <td>
              {{ new Date(event.modifiedAt).toLocaleString(currentLocale()) }}
            </td>
            <td class="text-right">
              <v-chip v-if="event.file === eventInfo.file" size="small">
                {{ $t('setup.isOpen') }}
              </v-chip>
              <v-btn
                v-else
                size="small"
                variant="text"
                prepend-icon="mdi-folder-open-outline"
                @click="onOpen(event.file)"
              >
                {{ $t('setup.open') }}
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="openDialog = false">
          {{ $t('common.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-overlay
    :model-value="!!switchingTo"
    persistent
    class="align-center justify-center"
  >
    <v-card class="pa-6 d-flex align-center ga-4">
      <v-progress-circular indeterminate color="primary" />
      {{ $t('setup.opening', { name: switchingTo && eventName(switchingTo) }) }}
    </v-card>
  </v-overlay>
</template>
