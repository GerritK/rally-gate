<script setup lang="ts">
import type { Starter } from '@rally-gate/shared';
import { formatWholeSeconds } from '../format';
import { onUnmounted, ref, watch } from 'vue';
import { serverOffsetMs } from '../api/time';
import type { StageRun } from '../api/stage-runs';
import {
  cancelTonesExcept,
  enableSound,
  scheduleTones,
  soundEnabled,
} from '../start-sound';
import ClassChip from './ClassChip.vue';
import ClockTime from './ClockTime.vue';
import CrewName from './CrewName.vue';
import StartCountdown from './StartCountdown.vue';
import StartNumber from './StartNumber.vue';

/**
 * Live Timing's Up next, the same in every start mode; only the buttons
 * differ (`docs/frontend-structure.md`). A car with `slot` set is counting
 * down; on a timetable the others show the slot from the start list. Fullscreen shows only this card, for a tablet at the line, and
 * `readonly` drops every button for a screen that only shows it.
 */
export interface UpNextRow {
  starter: Starter;
  /** The car's slot run while it is queued. */
  slot?: StageRun;
  /** Seen at a pre-start gate since its last run. */
  atStart?: boolean;
  unscrutineered?: boolean;
}

const props = defineProps<{
  title: string;
  rows: UpNextRow[];
  /** Which button starts a car (New slot on a timetable); none on a stage not running. */
  action: 'startNow' | 'countdown' | 'newSlot' | null;
  canCancel?: boolean;
  /** Timetable: Delay in the header. */
  canDelay?: boolean;
  countdownMs: number;
  /** A slot stage: the start lights, grey until a countdown runs. */
  lights?: boolean;
  /** Timetable: Delay since the list was posted, noted under the title. */
  delayMs?: number;
  /** An entry or run id whose request is in flight. */
  busyId?: string | null;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  startNow: [entryId: string];
  countdown: [entryId: string];
  cancel: [run: StageRun];
  newSlot: [entryId: string];
  delay: [];
}>();

const card = ref<HTMLElement | null>(null);

function onCountdown(entryId: string) {
  enableSound();
  emit('countdown', entryId);
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void card.value?.requestFullscreen();
}

// Rescheduled whenever the queue changes or sound comes on; a cancelled
// countdown falls out of the queue and is silenced. Keyed by slot time too:
// Delay and New slot move a run's slot, and its old tones must go with it.
watch(
  [() => props.rows.map((row) => row.slot), soundEnabled],
  ([slots]) => {
    const now = Date.now() + serverOffsetMs.value;
    const queued = slots.filter((slot): slot is StageRun => !!slot);
    const key = (slot: StageRun) => `${slot.id}@${slot.startTime}`;
    for (const slot of queued) {
      scheduleTones(key(slot), new Date(slot.startTime).getTime(), now);
    }
    cancelTonesExcept(new Set(queued.map(key)));
  },
  { immediate: true },
);
// Off Live Timing a tone is for a car nobody is looking at.
onUnmounted(() => cancelTonesExcept(new Set()));
</script>

<template>
  <div ref="card" class="rg-up-next h-100">
    <v-card class="h-100">
      <v-card-item>
        <!-- Wraps instead of clipping: a title clips its overflow, which hid
             Fullscreen behind Enable sound and Delay on a narrow card. -->
        <v-card-title class="d-flex flex-wrap align-center ga-2 rg-card-head">
          {{ title }}
          <v-spacer />
          <v-btn
            v-if="
              (action === 'countdown' || action === 'newSlot') &&
              !soundEnabled &&
              !readonly
            "
            size="small"
            variant="tonal"
            color="warning"
            prepend-icon="mdi-volume-high"
            @click="enableSound"
          >
            {{ $t('countdown.enableSound') }}
          </v-btn>
          <v-btn
            v-if="canDelay && !readonly"
            size="small"
            variant="tonal"
            prepend-icon="mdi-clock-plus-outline"
            @click="emit('delay')"
          >
            {{ $t('timetable.delay') }}
          </v-btn>
          <v-btn
            icon="mdi-fullscreen"
            size="small"
            variant="text"
            :title="$t('countdown.fullscreen')"
            @click="toggleFullscreen"
          />
        </v-card-title>
        <v-card-subtitle v-if="delayMs">
          {{
            $t('timetable.delayedBy', {
              time: formatWholeSeconds(delayMs / 1000).replace(/^0/, ''),
            })
          }}
        </v-card-subtitle>
      </v-card-item>
      <v-card-text v-if="rows.length > 0">
        <!-- Always there on a slot stage, so the card doesn't grow when the
             first countdown starts. -->
        <div v-if="lights" class="d-flex justify-center mb-4 rg-countdown">
          <StartCountdown
            :slot="rows[0].slot?.startTime ?? rows[0].starter.slotTime"
            :countdown-ms="countdownMs"
            :idle="!rows[0].slot"
          />
        </div>
        <div class="d-flex flex-wrap align-center ga-4">
          <div class="rg-next-number">
            <StartNumber :number="rows[0].starter.startNumber" />
          </div>
          <CrewName :crew="rows[0].starter" class="rg-next-driver" />
          <v-chip
            v-if="rows[0].unscrutineered"
            color="warning"
            prepend-icon="mdi-clipboard-alert-outline"
          >
            {{ $t('live.notScrutineered') }}
          </v-chip>
          <v-chip
            v-if="rows[0].atStart"
            color="success"
            prepend-icon="mdi-flag-variant"
          >
            {{ $t('live.atStart') }}
          </v-chip>
          <ClassChip
            v-if="rows[0].starter.mainClassName"
            :name="rows[0].starter.mainClassName"
            main
            class="ms-auto"
          />
        </div>
        <v-btn
          v-if="action === 'newSlot' && !readonly"
          variant="tonal"
          size="large"
          block
          class="mt-4"
          prepend-icon="mdi-calendar-arrow-right"
          :disabled="!!rows[0].slot?.startPassingAt"
          :loading="busyId === rows[0].starter.entryId"
          @click="emit('newSlot', rows[0].starter.entryId)"
        >
          {{ $t('timetable.newSlot') }}
        </v-btn>
        <!-- Where Countdown was, the same size, so nothing moves. -->
        <template v-else-if="rows[0].slot">
          <v-btn
            v-if="!readonly"
            variant="tonal"
            size="large"
            block
            class="mt-4"
            :disabled="!canCancel || !!rows[0].slot.startPassingAt"
            :loading="busyId === rows[0].slot.id"
            @click="emit('cancel', rows[0].slot)"
          >
            <v-icon icon="mdi-close" start />
            {{ $t('countdown.cancel') }}
          </v-btn>
        </template>
        <v-btn
          v-else-if="action && !readonly"
          color="primary"
          size="large"
          block
          :prepend-icon="
            action === 'countdown' ? 'mdi-timer-play-outline' : 'mdi-play'
          "
          class="mt-4"
          :loading="busyId === rows[0].starter.entryId"
          @click="
            action === 'countdown'
              ? onCountdown(rows[0].starter.entryId)
              : emit('startNow', rows[0].starter.entryId)
          "
        >
          {{
            action === 'countdown' ? $t('countdown.start') : $t('live.startNow')
          }}
        </v-btn>
        <template v-if="rows.length > 1">
          <v-divider class="mt-4 mb-2" />
          <div class="text-overline text-medium-emphasis">
            {{ $t('live.then') }}
          </div>
          <div class="rg-then-grid">
            <div
              v-for="row in rows.slice(1, 3)"
              :key="row.starter.entryId"
              class="d-flex flex-wrap align-center ga-3"
            >
              <span class="rg-then-number">
                <StartNumber :number="row.starter.startNumber" />
              </span>
              <CrewName :crew="row.starter" class="rg-then-driver" />
              <v-icon
                v-if="row.atStart"
                icon="mdi-flag-variant"
                color="success"
                :title="$t('live.atStart')"
              />
              <!-- On a narrow card this wraps below, still at the end. -->
              <div class="d-flex align-center ga-2 ms-auto">
                <ClassChip
                  v-if="row.starter.mainClassName"
                  :name="row.starter.mainClassName"
                  main
                />
                <template v-if="row.slot">
                  <ClockTime :time="row.slot.startTime" />
                  <v-btn
                    v-if="action === 'newSlot' && !readonly"
                    icon="mdi-calendar-arrow-right"
                    size="small"
                    variant="text"
                    :title="$t('timetable.newSlot')"
                    :disabled="!!row.slot.startPassingAt"
                    :loading="busyId === row.starter.entryId"
                    @click="emit('newSlot', row.starter.entryId)"
                  />
                  <v-btn
                    v-else-if="canCancel && !readonly"
                    icon="mdi-close"
                    size="small"
                    variant="text"
                    :title="$t('countdown.cancel')"
                    :loading="busyId === row.slot.id"
                    @click="emit('cancel', row.slot)"
                  />
                </template>
                <ClockTime
                  v-else-if="row.starter.slotTime"
                  :time="row.starter.slotTime"
                />
                <v-btn
                  v-if="!row.slot && action === 'newSlot' && !readonly"
                  icon="mdi-calendar-arrow-right"
                  size="small"
                  variant="text"
                  :title="$t('timetable.newSlot')"
                  :loading="busyId === row.starter.entryId"
                  @click="emit('newSlot', row.starter.entryId)"
                />
                <v-btn
                  v-else-if="!row.slot && action === 'countdown' && !readonly"
                  icon="mdi-timer-play-outline"
                  size="small"
                  variant="tonal"
                  color="primary"
                  :title="$t('countdown.start')"
                  :loading="busyId === row.starter.entryId"
                  @click="onCountdown(row.starter.entryId)"
                />
              </div>
            </div>
          </div>
        </template>
      </v-card-text>
      <v-card-text v-else class="rg-empty">
        {{ $t('live.allStarted') }}
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
/* Readable from a tablet at arm's length or more. */
.rg-next-number {
  font-size: 3.5rem;
}
.rg-next-driver {
  font-size: 1.75rem;
}
/* Two columns where they fit, one on a narrow card. */
.rg-then-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 16px;
}
.rg-then-number {
  font-size: 2rem;
}
.rg-then-driver {
  font-size: 1.1rem;
}
.rg-countdown {
  font-size: 1.25rem;
}
.rg-card-head {
  white-space: normal;
}

/* Fullscreen at the line: everything scales from the root font size. */
.rg-up-next:fullscreen {
  font-size: 2.2vmin;
  padding: 2vmin;
  background: rgb(var(--v-theme-background));
}
.rg-up-next:fullscreen .rg-next-number {
  font-size: 12vmin;
}
.rg-up-next:fullscreen .rg-next-driver {
  font-size: 6vmin;
}
.rg-up-next:fullscreen .rg-countdown {
  font-size: 5vmin;
}
</style>
