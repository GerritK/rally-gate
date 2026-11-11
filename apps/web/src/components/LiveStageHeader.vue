<script setup lang="ts">
import { StageStatus } from '@rally-gate/shared';
import { can } from '../api/auth';
import type { Gate } from '../api/gates';
import type { Stage } from '../api/stages';
import type { StartOrder } from '../api/start-order';
import { ROW_STATE_DISPLAY, type RowState } from '../live-rows';
import GateFlow from './GateFlow.vue';

/** Live timing's stage card: its lifecycle buttons, the counts per state
 *  and the gate line. */
defineProps<{
  stage: Stage;
  startOrder: StartOrder | null;
  /** "Start list published …", or that it still follows the entries. */
  startListStatus: string;
  stateCounts: { state: RowState; count: number }[];
  gateFlow: { gate: Gate; label: string }[];
  flashingGateIds: Record<string, boolean>;
  activating: boolean;
  closing: boolean;
}>();
const emit = defineEmits<{
  freeze: [];
  unfreeze: [];
  printStartList: [];
  activate: [];
  close: [];
}>();
</script>

<template>
  <v-card>
    <v-card-item>
      <v-card-title> {{ stage.id }} · {{ stage.name }} </v-card-title>
      <v-card-subtitle>
        {{ startListStatus }}
      </v-card-subtitle>
      <template #append>
        <div class="d-flex flex-wrap justify-end ga-2">
          <v-btn
            v-if="
              stage.status === StageStatus.NOT_STARTED &&
              !startOrder?.frozen &&
              can('setup')
            "
            color="primary"
            prepend-icon="mdi-lock"
            @click="emit('freeze')"
          >
            {{ $t('live.freezeStartList') }}
          </v-btn>
          <v-btn
            v-if="
              stage.status === StageStatus.NOT_STARTED &&
              startOrder?.frozen &&
              can('setup')
            "
            variant="text"
            prepend-icon="mdi-lock-open-variant"
            @click="emit('unfreeze')"
          >
            {{ $t('live.unfreeze') }}
          </v-btn>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-printer"
            :disabled="!startOrder"
            @click="emit('printStartList')"
          >
            {{ $t('live.printStartList') }}
          </v-btn>
          <v-btn
            v-if="
              stage.status === StageStatus.NOT_STARTED && can('activateStage')
            "
            :loading="activating"
            color="success"
            variant="outlined"
            prepend-icon="mdi-play"
            @click="emit('activate')"
          >
            {{ $t('live.activateStage') }}
          </v-btn>
          <v-btn
            v-if="stage.status === StageStatus.ACTIVE && can('activateStage')"
            :loading="closing"
            color="error"
            variant="outlined"
            prepend-icon="mdi-flag-checkered"
            @click="emit('close')"
          >
            {{ $t('live.closeStage') }}
          </v-btn>
        </div>
      </template>
    </v-card-item>

    <v-card-text>
      <div class="d-flex flex-wrap align-center ga-2 mb-3">
        <v-chip
          v-for="{ state, count } in stateCounts"
          :key="state"
          :color="ROW_STATE_DISPLAY[state].color"
          :prepend-icon="ROW_STATE_DISPLAY[state].icon"
          variant="tonal"
        >
          {{ count }} {{ ROW_STATE_DISPLAY[state].label }}
        </v-chip>
      </div>
      <GateFlow :nodes="gateFlow" :flashing="flashingGateIds" />
      <v-alert
        v-if="startOrder && !startOrder.frozen"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-4"
      >
        <i18n-t keypath="live.liveStartList" scope="global">
          <template #freeze>
            <strong>{{ $t('live.freezeWhenPosted') }}</strong>
          </template>
          <template #link>
            <router-link to="/setup/start" class="rg-link"
              >{{ $t('nav.setup') }} → {{ $t('setup.start') }}</router-link
            >
          </template>
        </i18n-t>
      </v-alert>
    </v-card-text>
  </v-card>
</template>
