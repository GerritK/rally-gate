<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { isOutOfEvent, VehicleStatus } from '@rally-gate/shared';
import { fetchVehicles, type Vehicle } from '../api/vehicles';
import { fetchVehicleClasses, type VehicleClass } from '../api/vehicle-classes';
import ClassChip from '../components/ClassChip.vue';
import CrewName from '../components/CrewName.vue';
import StartNumber from '../components/StartNumber.vue';
import VehicleDialog from '../components/VehicleDialog.vue';
import VehicleStatusActions from '../components/VehicleStatusActions.vue';
import { VEHICLE_STATUS_DISPLAY } from '../format';
import { transponderWarning } from '../vehicle-status';

/**
 * Two stations, one job each: the desk checks crews in, the scrutineers pass
 * cars. Crews turn up at either in no particular order, so both find the
 * car in front of them; what differs is which cars are still open there and
 * which step is theirs. The station is the device's, kept across reloads.
 */
type Station = 'desk' | 'scrutineering';
const STATIONS: Record<
  Station,
  {
    label: string;
    icon: string;
    /** Still to be done here. */
    open: VehicleStatus;
    listTitle: string;
    allDone: string;
    /** Shown as a button beside the step rather than in ⋮. */
    alsoShow: VehicleStatus[];
  }
> = {
  desk: {
    label: 'Desk',
    icon: 'mdi-clipboard-check-outline',
    open: VehicleStatus.REGISTERED,
    listTitle: 'To check in',
    allDone: 'Every car is checked in.',
    // An event without a technical check passes cars at the desk.
    alsoShow: [VehicleStatus.SCRUTINEERED],
  },
  scrutineering: {
    label: 'Scrutineering',
    icon: 'mdi-check-decagram',
    open: VehicleStatus.CHECKED_IN,
    listTitle: 'To scrutineer',
    allDone: 'No checked-in car is waiting for scrutineering.',
    alsoShow: [],
  },
};

const STATION_KEY = 'rg-check-in-station';
function storedStation(): Station {
  try {
    const value = localStorage.getItem(STATION_KEY);
    return value === 'scrutineering' ? value : 'desk';
  } catch {
    return 'desk';
  }
}
const station = ref<Station>(storedStation());
watch(station, (value) => {
  try {
    localStorage.setItem(STATION_KEY, value);
  } catch {
    // Private mode or blocked storage: it just isn't remembered.
  }
});
const here = computed(() => STATIONS[station.value]);

const vehicles = ref<Vehicle[]>([]);
const classes = ref<VehicleClass[]>([]);
const query = ref('');
const selectedId = ref<string | null>(null);
// A car picked at the other station would offer that station's step.
watch(station, () => (selectedId.value = null));
const dialogOpen = ref(false);
const search = ref<{ focus: () => void } | null>(null);
const carCard = ref<{ $el: HTMLElement } | null>(null);

/** Out of the event doesn't count against either station. */
const counts = computed(() => {
  const starters = vehicles.value.filter((v) => !isOutOfEvent(v.status));
  return {
    starters: starters.length,
    checkedIn: starters.filter((v) => v.status !== VehicleStatus.REGISTERED)
      .length,
    scrutineered: starters.filter(
      (v) => v.status === VehicleStatus.SCRUTINEERED,
    ).length,
  };
});

const open = computed(() =>
  vehicles.value.filter((v) => v.status === here.value.open),
);

/** Accents and case don't matter: "dvorak" finds Dvořák. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Without a search, what's still open here, shrinking over the day. A
 *  search looks at every car, so one already done (or out) is still found
 *  when its crew comes back: a number finds its car first, then any whose
 *  number starts with it; a name finds driver or co-driver. */
const shown = computed(() => {
  const q = fold(query.value.trim());
  if (!q) return open.value;
  return vehicles.value
    .filter((v) =>
      /^\d+$/.test(q)
        ? String(v.startNumber).startsWith(q)
        : fold(
            [
              v.driverFirstName,
              v.driverLastName,
              v.coDriverFirstName,
              v.coDriverLastName,
            ]
              .filter(Boolean)
              .join(' '),
          ).includes(q),
    )
    .sort(
      (a, b) =>
        Number(String(b.startNumber) === q) -
          Number(String(a.startNumber) === q) || a.startNumber - b.startNumber,
    );
});

const selected = computed(
  () => vehicles.value.find((v) => v.id === selectedId.value) ?? null,
);
const selectedClasses = computed(() =>
  classes.value.filter((c) =>
    selected.value?.classes.some((o) => o.id === c.id),
  ),
);

/** The desk's most common correction, taken with Check in rather than
 *  through Edit. */
const transponder = ref('');
watch(selected, (v) => (transponder.value = v?.transponderId ?? ''), {
  immediate: true,
});
const transponderAtDesk = computed(
  () =>
    station.value === 'desk' &&
    selected.value?.status === VehicleStatus.REGISTERED,
);
const transponderShared = computed(() =>
  transponderWarning(vehicles.value, transponder.value, selected.value?.id),
);
const withStep = computed(() =>
  transponderAtDesk.value
    ? { transponderId: transponder.value.trim() || null }
    : undefined,
);

/** On a phone the card sits above the list, so a car picked far down would
 *  be selected out of sight: bring the card up. Beside the list it stays in
 *  view by itself. */
async function pick(id: string) {
  selectedId.value = id;
  if (!window.matchMedia('(max-width: 959px)').matches) return;
  await nextTick();
  carCard.value?.$el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function pickFirst() {
  if (shown.value.length > 0) pick(shown.value[0].id);
}

/** The station moves on: the next car is typed into an empty search. */
async function onSaved(saved: Vehicle) {
  vehicles.value = vehicles.value.map((v) => (v.id === saved.id ? saved : v));
  selectedId.value = null;
  query.value = '';
  await nextTick();
  search.value?.focus();
}

async function refresh() {
  [vehicles.value, classes.value] = await Promise.all([
    fetchVehicles(),
    fetchVehicleClasses(),
  ]);
}

onMounted(refresh);
</script>

<template>
  <v-btn
    variant="text"
    prepend-icon="mdi-arrow-left"
    to="/vehicles"
    class="mb-4"
  >
    Back to Vehicles
  </v-btn>

  <v-card class="mb-4">
    <v-card-item>
      <v-card-title>Check-in</v-card-title>
      <v-card-subtitle>
        {{ counts.checkedIn }} of {{ counts.starters }} checked in ·
        {{ counts.scrutineered }} scrutineered
      </v-card-subtitle>
      <template #append>
        <v-btn-toggle
          v-model="station"
          mandatory
          density="comfortable"
          color="secondary"
          variant="outlined"
          divided
        >
          <v-btn
            v-for="(s, key) in STATIONS"
            :key="key"
            :value="key"
            :prepend-icon="s.icon"
          >
            {{ s.label }}
          </v-btn>
        </v-btn-toggle>
      </template>
    </v-card-item>
    <v-card-text>
      <v-text-field
        ref="search"
        v-model="query"
        label="Start number or name"
        prepend-inner-icon="mdi-magnify"
        hint="Enter picks the first match. A search finds every car, done or not."
        persistent-hint
        clearable
        autofocus
        class="rg-checkin-search"
        @keydown.enter="pickFirst"
      />
    </v-card-text>
  </v-card>

  <div class="rg-checkin-grid">
    <v-card>
      <v-card-item>
        <v-card-title class="text-subtitle-1">
          {{ query ? 'Matches' : here.listTitle }} ({{ shown.length }})
        </v-card-title>
      </v-card-item>
      <v-list v-if="shown.length > 0" density="compact" class="pt-0">
        <v-list-item
          v-for="v in shown"
          :key="v.id"
          :active="v.id === selectedId"
          @click="pick(v.id)"
        >
          <template #prepend>
            <StartNumber :number="v.startNumber" class="me-4" />
          </template>
          <CrewName :crew="v" />
          <template v-if="query || v.status !== here.open" #append>
            <v-chip
              size="small"
              :color="VEHICLE_STATUS_DISPLAY[v.status].color"
              :prepend-icon="VEHICLE_STATUS_DISPLAY[v.status].icon"
            >
              {{ VEHICLE_STATUS_DISPLAY[v.status].label }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list>
      <v-card-text v-else class="rg-empty">
        {{ query ? 'No car matches.' : here.allDone }}
      </v-card-text>
    </v-card>

    <v-card v-if="selected" ref="carCard" class="rg-checkin-car">
      <v-card-item>
        <template #prepend>
          <StartNumber
            :number="selected.startNumber"
            class="me-4"
            style="font-size: 2.5rem"
          />
        </template>
        <CrewName :crew="selected" style="font-size: 1.5rem" />
      </v-card-item>
      <v-card-text>
        <dl class="rg-facts">
          <dt>Status</dt>
          <dd>
            <v-chip
              size="small"
              :color="VEHICLE_STATUS_DISPLAY[selected.status].color"
              :prepend-icon="VEHICLE_STATUS_DISPLAY[selected.status].icon"
            >
              {{ VEHICLE_STATUS_DISPLAY[selected.status].label }}
            </v-chip>
          </dd>
          <dt>Car</dt>
          <dd>
            {{
              [selected.body, selected.chassis].filter(Boolean).join(' · ') ||
              '-'
            }}
          </dd>
          <dt>Classes</dt>
          <dd v-if="selectedClasses.length > 0" class="d-flex flex-wrap ga-1">
            <ClassChip
              v-for="c in selectedClasses"
              :key="c.id"
              :name="c.name"
              :main="c.main"
            />
          </dd>
          <dd v-else class="text-medium-emphasis">-</dd>
          <template v-if="!transponderAtDesk">
            <dt>Transponder</dt>
            <dd
              :class="
                selected.transponderId ? 'rg-timing' : 'text-medium-emphasis'
              "
            >
              {{ selected.transponderId ?? '-' }}
            </dd>
          </template>
        </dl>
        <v-text-field
          v-if="transponderAtDesk"
          v-model="transponder"
          label="Transponder ID"
          :messages="transponderShared"
          class="rg-checkin-transponder rg-field-warning mt-4"
        />
      </v-card-text>
      <v-card-actions class="rg-checkin-actions">
        <VehicleStatusActions
          :vehicle="selected"
          large
          :also-show="here.alsoShow"
          :with-step="withStep"
          @saved="onSaved"
        >
          <v-btn
            variant="tonal"
            prepend-icon="mdi-pencil"
            @click="dialogOpen = true"
          >
            Edit
          </v-btn>
        </VehicleStatusActions>
      </v-card-actions>
    </v-card>
    <v-card v-else class="rg-checkin-car">
      <v-card-text class="rg-empty">
        Type a start number and press Enter, or pick a car from the list.
      </v-card-text>
    </v-card>
  </div>

  <VehicleDialog
    v-model="dialogOpen"
    :vehicle="selected"
    :classes="classes"
    :vehicles="vehicles"
    @saved="refresh"
  />
</template>

<style scoped>
.rg-checkin-search {
  max-width: 420px;
}
.rg-checkin-transponder {
  max-width: 320px;
}
/* The car's facts above, what to do with it below. */
.rg-checkin-actions {
  border-top: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding: 12px 16px;
}
/* The list beside the car being checked in; stacked on a phone. */
.rg-checkin-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
/* The picked car stays in view however far down the list it was picked:
   beside the list it travels with the page under the app bar, above it on
   a phone, where the list would otherwise push it off the screen. */
.rg-checkin-car {
  position: sticky;
  top: 80px;
}
@media (max-width: 959px) {
  .rg-checkin-grid {
    grid-template-columns: 1fr;
  }
  .rg-checkin-car {
    position: static;
    order: -1;
    scroll-margin-top: 80px;
  }
}
</style>
