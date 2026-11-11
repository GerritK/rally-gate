<script setup lang="ts">
import { useLoad } from '../load';
import LoadedPage from '../components/LoadedPage.vue';
import { can } from '../api/auth';
import { RallyStatus, StageStatus } from '@rally-gate/shared';
import { ref } from 'vue';
import { useDisplay } from 'vuetify';
import {
  createEvent,
  fetchEventInfo,
  openEvent,
  switchEvent,
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
import EventSwitchOverlay from '../components/EventSwitchOverlay.vue';
import EventTable from '../components/EventTable.vue';
import ImportEventButton from '../components/ImportEventButton.vue';
import NewEventDialog from '../components/NewEventDialog.vue';
import StatusChip from '../components/StatusChip.vue';
import { isOnline, isReady, RALLY_STATUS_DISPLAY } from '../format';
import { preStartCheck, type CheckFinding } from '../pre-start-check';
import { useUnsavedChanges } from '../unsaved-changes';
import { notify, t, useConfirm } from '@rally-gate/ui';

const rallyInfo = ref<RallyInfo>({ name: '', date: '', location: '' });
const saving = ref(false);
const eventInfo = ref<EventInfo | null>(null);
const newDialog = ref(false);
const openDialog = ref(false);
const { markSaved } = useUnsavedChanges(() => rallyInfo.value);
const confirm = useConfirm();
const { smAndDown } = useDisplay();
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

function onOpen(file: string) {
  openDialog.value = false;
  return switchEvent(() => openEvent(file));
}

async function loadEvents() {
  eventInfo.value = await fetchEventInfo();
}

const load = useLoad(async () => {
  const existing = await fetchRallyInfo();
  if (existing) rallyInfo.value = existing;
  markSaved();
  await loadEvents();
});
</script>

<template>
  <LoadedPage :load="load">
    <v-card class="mb-6">
      <v-card-item>
        <v-card-title>{{ $t('setup.event') }}</v-card-title>
        <v-card-subtitle v-if="eventInfo">
          <v-icon icon="mdi-file-outline" size="small" />
          {{ eventInfo.file }}
        </v-card-subtitle>
        <template v-if="eventInfo?.switchable && can('setup')" #append>
          <v-btn
            variant="text"
            prepend-icon="mdi-plus"
            @click="newDialog = true"
          >
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
        <v-form
          :readonly="!can('setup')"
          class="d-flex flex-wrap align-center ga-3"
          @submit.prevent="onSave"
        >
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
            v-if="can('setup')"
            type="submit"
            color="primary"
            :loading="saving"
            prepend-icon="mdi-content-save"
          >
            {{ $t('common.save') }}
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>

    <v-card class="mb-6">
      <v-card-item>
        <v-card-title>{{ $t('rally.title') }}</v-card-title>
        <template #append>
          <StatusChip :display="RALLY_STATUS_DISPLAY[rallyStatus]" />
          <v-menu v-if="rallyStatus === RallyStatus.CLOSED && can('setup')">
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
          v-if="rallyStatus === RallyStatus.SETUP && can('setup')"
          color="success"
          variant="outlined"
          prepend-icon="mdi-play"
          @click="onStart"
        >
          {{ $t('rally.start') }}
        </v-btn>
        <v-btn
          v-else-if="rallyStatus === RallyStatus.RUNNING && can('setup')"
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
      :aria-label="$t('rally.checkTitle')"
      :fullscreen="smAndDown"
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
          to="/setup/start"
          prepend-icon="mdi-sort-numeric-ascending"
        >
          <v-card-title>{{ $t('setup.start') }}</v-card-title>
          <v-card-text>{{ $t('setup.startHint') }}</v-card-text>
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
      <v-col v-if="can('setup')" cols="12" sm="4">
        <v-card class="h-100" to="/setup/access" prepend-icon="mdi-key-chain">
          <v-card-title>{{ $t('access.title') }}</v-card-title>
          <v-card-text>{{ $t('access.hint') }}</v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <NewEventDialog
      v-model="newDialog"
      :create="(input) => switchEvent(() => createEvent(input))"
    />

    <v-dialog
      v-model="openDialog"
      max-width="600"
      :fullscreen="smAndDown"
      :aria-label="$t('setup.openEvent')"
    >
      <v-card v-if="eventInfo">
        <v-card-item>
          <v-card-title>{{ $t('setup.openEvent') }}</v-card-title>
          <v-card-subtitle>
            {{ $t('setup.onThisComputer', { n: eventInfo.events.length }) }}
          </v-card-subtitle>
          <template #append>
            <ImportEventButton variant="tonal" @imported="loadEvents" />
          </template>
        </v-card-item>
        <EventTable
          :events="eventInfo.events"
          :open-file="eventInfo.file"
          @open="onOpen"
          @deleted="loadEvents"
        />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="openDialog = false">
            {{ $t('common.close') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <EventSwitchOverlay />
  </LoadedPage>
</template>
