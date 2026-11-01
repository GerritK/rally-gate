<script setup lang="ts">
import type { Starter } from '@rally-gate/shared';
import { ref, watch } from 'vue';
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
 * down. Fullscreen shows only this card, for a tablet at the line, and
 * `readonly` drops every button for a screen that only shows it.
 */
export interface UpNextRow {
  starter: Starter;
  /** The car's slot run while it is queued. */
  slot?: StageRun;
  unscrutineered?: boolean;
}

const props = defineProps<{
  title: string;
  rows: UpNextRow[];
  /** Which button starts a car; none on a stage not running. */
  action: 'startNow' | 'countdown' | null;
  canCancel?: boolean;
  /** An entry or run id whose request is in flight. */
  busyId?: string | null;
  readonly?: boolean;
}>();
const emit = defineEmits<{
  startNow: [entryId: string];
  countdown: [entryId: string];
  cancel: [run: StageRun];
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
// countdown falls out of the queue and is silenced.
watch(
  [() => props.rows.map((row) => row.slot), soundEnabled],
  ([slots]) => {
    const now = Date.now() + serverOffsetMs.value;
    const queued = slots.filter((slot): slot is StageRun => !!slot);
    for (const slot of queued) {
      scheduleTones(slot.id, new Date(slot.startTime).getTime(), now);
    }
    cancelTonesExcept(new Set(queued.map((slot) => slot.id)));
  },
  { immediate: true },
);
</script>

<template>
  <div ref="card" class="rg-up-next h-100">
    <v-card class="h-100">
      <v-card-item>
        <v-card-title class="d-flex align-center ga-2">
          {{ title }}
          <v-spacer />
          <v-btn
            v-if="action === 'countdown' && !soundEnabled && !readonly"
            size="small"
            variant="tonal"
            color="warning"
            prepend-icon="mdi-volume-high"
            @click="enableSound"
          >
            {{ $t('countdown.enableSound') }}
          </v-btn>
          <v-btn
            icon="mdi-fullscreen"
            size="small"
            variant="text"
            :title="$t('countdown.fullscreen')"
            @click="toggleFullscreen"
          />
        </v-card-title>
      </v-card-item>
      <v-card-text v-if="rows.length > 0">
        <div
          v-if="rows[0].slot"
          class="d-flex justify-center mb-4 rg-countdown"
        >
          <StartCountdown :slot="rows[0].slot.startTime" />
        </div>
        <div class="d-flex align-center ga-4">
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
          <ClassChip
            v-if="rows[0].starter.mainClassName"
            :name="rows[0].starter.mainClassName"
            main
            class="ms-auto"
          />
        </div>
        <!-- Where Countdown was, the same size, so nothing moves. -->
        <template v-if="rows[0].slot">
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
              class="d-flex align-center ga-3"
            >
              <span class="rg-then-number">
                <StartNumber :number="row.starter.startNumber" />
              </span>
              <CrewName :crew="row.starter" class="rg-then-driver" />
              <ClassChip
                v-if="row.starter.mainClassName"
                :name="row.starter.mainClassName"
                main
                class="ms-auto"
              />
              <template v-if="row.slot">
                <ClockTime :time="row.slot.startTime" />
                <v-btn
                  v-if="canCancel && !readonly"
                  icon="mdi-close"
                  size="small"
                  variant="text"
                  :title="$t('countdown.cancel')"
                  :loading="busyId === row.slot.id"
                  @click="emit('cancel', row.slot)"
                />
              </template>
              <v-btn
                v-else-if="action === 'countdown' && !readonly"
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
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
