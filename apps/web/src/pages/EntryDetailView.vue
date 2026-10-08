<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { StageRunStatus, StageStatus, EntryStatus } from '@rally-gate/shared';
import { formatClockTime } from '@rally-gate/ui';
import {
  fetchOverallClassification,
  fetchStageClassification,
  type Placing,
  type OverallPlacing,
} from '../api/classification';
import { fetchStageRuns, type StageRun } from '../api/stage-runs';
import { fetchStages, type Stage } from '../api/stages';
import { fetchEntries, type Entry } from '../api/entries';
import { fetchEntryClasses, type EntryClass } from '../api/entry-classes';
import ClassChip from '../components/ClassChip.vue';
import CrewName from '../components/CrewName.vue';
import ManualMark from '../components/ManualMark.vue';
import TableLegend from '../components/TableLegend.vue';
import StartNumber from '../components/StartNumber.vue';
import EntryDialog from '../components/EntryDialog.vue';
import EntryStatusActions from '../components/EntryStatusActions.vue';
import { flagName, flagUrl } from '../crew';
import { transponderLabels } from '../entry-status';
import {
  formatDuration,
  formatGap,
  runStatusColor,
  TIMING_MARKS,
  type TimingMark,
  ENTRY_STATUS_DISPLAY,
} from '../format';

const props = defineProps<{ entryId: string }>();

const entries = ref<Entry[]>([]);
const classes = ref<EntryClass[]>([]);
const stages = ref<Stage[]>([]);
const runs = ref<StageRun[]>([]);
/** Each started stage's classification, all classes. */
const stageRanks = ref(new Map<string, Placing[]>());
const overall = ref<OverallPlacing[]>([]);
const loaded = ref(false);
const dialogOpen = ref(false);

const entry = computed(
  () => entries.value.find((v) => v.id === props.entryId) ?? null,
);
const ownClasses = computed(() =>
  classes.value.filter((c) => entry.value?.classes.some((o) => o.id === c.id)),
);

/** Written out in full here, whatever the event's name format: the header
 *  shows the crew as everywhere else, this is the record. */
const people = computed(() => {
  const v = entry.value;
  if (!v) return [];
  const full = (first: string | null, last: string | null) =>
    [first, last].filter(Boolean).join(' ');
  return [
    {
      role: 'Driver',
      name: full(v.driverFirstName, v.driverLastName),
      flag: v.driverFlag,
    },
    {
      role: 'Co-driver',
      name: full(v.coDriverFirstName, v.coDriverLastName),
      flag: v.coDriverFlag,
    },
  ];
});

const standing = computed(() =>
  overall.value.find((e) => e.entryId === props.entryId),
);

/** One row per stage in stage order: the attempt that counts (a voided one
 *  never does) with its rank among all classes, or what kept it from one. */
const stageRows = computed(() =>
  [...stages.value]
    .sort((a, b) => a.stageNumber - b.stageNumber)
    .map((stage) => {
      const run = runs.value.find(
        (r) =>
          r.entryId === props.entryId && r.stageId === stage.id && !r.voided,
      );
      const rank = stageRanks.value
        .get(stage.id)
        ?.find((e) => e.entryId === props.entryId);
      let state: { label: string; color?: string } | null = null;
      if (run?.status === StageRunStatus.STARTED) {
        state = { label: 'On stage', color: runStatusColor('STARTED') };
      } else if (run?.status === StageRunStatus.CANCELLED) {
        state = { label: 'DNF', color: runStatusColor('CANCELLED') };
      } else if (!run && stage.status === StageStatus.CLOSED) {
        state = { label: 'DNS', color: 'warning' };
      } else if (!run) {
        state = {
          label:
            stage.status === StageStatus.ACTIVE ? 'Waiting' : 'Not started',
        };
      }
      // What a stage without a finish costs in the overall, so the rows
      // add up to the total above them.
      const notional = standing.value?.stageTimes.find(
        (t) => t.stageId === stage.id && t.notional,
      );
      return { stage, run, rank, state, notional };
    }),
);

const legendMarks = computed<TimingMark[]>(() => [
  ...(stageRows.value.some((r) => r.rank?.gapMs === 0)
    ? (['best'] as const)
    : []),
  ...(stageRows.value.some((r) => r.run?.startManual || r.run?.finishManual)
    ? (['manual'] as const)
    : []),
  ...(stageRows.value.some((r) => r.notional) ? (['notional'] as const) : []),
]);

async function refresh() {
  [entries.value, classes.value, stages.value, runs.value, overall.value] =
    await Promise.all([
      fetchEntries(),
      fetchEntryClasses(),
      fetchStages(),
      fetchStageRuns(),
      fetchOverallClassification(),
    ]);
  const started = stages.value.filter(
    (s) => s.status !== StageStatus.NOT_STARTED,
  );
  stageRanks.value = new Map(
    await Promise.all(
      started.map(
        async (s) => [s.id, await fetchStageClassification(s.id)] as const,
      ),
    ),
  );
  loaded.value = true;
}

onMounted(refresh);
</script>

<template>
  <v-btn
    variant="text"
    prepend-icon="mdi-arrow-left"
    to="/entries"
    class="mb-4"
  >
    Back to Entries
  </v-btn>

  <v-alert v-if="loaded && !entry" type="info" variant="tonal">
    No such entry in this event.
  </v-alert>

  <template v-if="entry">
    <v-card class="mb-4">
      <v-card-item class="rg-entry-head">
        <template #prepend>
          <StartNumber
            :number="entry.startNumber"
            class="me-4 rg-head-number"
          />
        </template>
        <CrewName :crew="entry" class="rg-head-crew" />
        <template #append>
          <v-btn
            variant="tonal"
            prepend-icon="mdi-pencil"
            @click="dialogOpen = true"
          >
            Edit
          </v-btn>
        </template>
      </v-card-item>
    </v-card>

    <!-- The same parts as the edit dialog, so a value is where it was set. -->
    <div class="rg-entry-grid">
      <v-card title="Crew">
        <v-card-text>
          <dl class="rg-facts">
            <template v-for="person in people" :key="person.role">
              <dt>{{ person.role }}</dt>
              <dd v-if="person.name">
                <div class="d-flex align-center ga-2">
                  <img :src="flagUrl(person.flag)" alt="" class="rg-flag" />
                  {{ person.name }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ flagName(person.flag) ?? 'No flag' }}
                </div>
              </dd>
              <dd v-else class="text-medium-emphasis">-</dd>
            </template>
          </dl>
        </v-card-text>
      </v-card>

      <v-card title="Car">
        <v-card-text>
          <dl class="rg-facts">
            <dt>Body</dt>
            <dd>{{ entry.body ?? '-' }}</dd>
            <dt>Chassis</dt>
            <dd>{{ entry.chassis ?? '-' }}</dd>
          </dl>
        </v-card-text>
      </v-card>

      <v-card title="Registration">
        <v-card-text>
          <dl class="rg-facts">
            <dt>Status</dt>
            <dd class="d-flex flex-wrap align-center ga-1">
              <v-chip
                size="small"
                :color="ENTRY_STATUS_DISPLAY[entry.status].color"
                :prepend-icon="ENTRY_STATUS_DISPLAY[entry.status].icon"
              >
                {{ ENTRY_STATUS_DISPLAY[entry.status].label }}
              </v-chip>
              <EntryStatusActions :entry="entry" @saved="refresh" />
            </dd>
            <dt>Classes</dt>
            <dd v-if="ownClasses.length > 0" class="d-flex flex-wrap ga-1">
              <ClassChip
                v-for="c in ownClasses"
                :key="c.id"
                :name="c.name"
                :main="c.main"
              />
            </dd>
            <dd v-else class="text-medium-emphasis">-</dd>
            <dt>Transponder</dt>
            <dd
              :class="
                entry.transponders.length > 0
                  ? 'rg-timing'
                  : 'text-medium-emphasis'
              "
            >
              <div v-for="label in transponderLabels(entry)" :key="label">
                {{ label }}
              </div>
              <template v-if="entry.transponders.length === 0">-</template>
            </dd>
          </dl>
        </v-card-text>
      </v-card>
    </div>

    <v-card class="mt-4">
      <v-card-item>
        <v-card-title>Times</v-card-title>
      </v-card-item>
      <!-- The standing is what this card is read for; the stages explain it. -->
      <v-card-text>
        <dl v-if="standing" class="rg-standing">
          <div>
            <dt>Overall</dt>
            <dd class="rg-timing">{{ standing.position }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd class="rg-timing">{{ formatDuration(standing.durationMs) }}</dd>
          </div>
          <div>
            <dt>Gap</dt>
            <dd class="rg-timing">{{ formatGap(standing.gapMs) }}</dd>
          </div>
        </dl>
        <div v-else class="rg-empty">
          {{
            entry?.status === EntryStatus.WITHDRAWN
              ? 'Retired: withdrawn, so not in the overall.'
              : entry?.status === EntryStatus.DISQUALIFIED
                ? 'Disqualified: not in any result.'
                : 'Not in the overall yet: no completed stage that counts.'
          }}
        </div>
      </v-card-text>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Stage</th>
            <th class="rg-time">Start<span class="rg-time-mark" /></th>
            <th class="rg-time">Finish<span class="rg-time-mark" /></th>
            <th class="rg-time">Time<span class="rg-time-mark" /></th>
            <th class="rg-time">Pos</th>
            <th class="rg-time">Gap</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ stage, run, rank, state, notional } in stageRows"
            :key="stage.id"
          >
            <td>
              <router-link
                :to="`/results/stages/${stage.id}`"
                class="rg-link"
                >{{ stage.id }}</router-link
              >
              <span class="text-medium-emphasis"> · {{ stage.name }}</span>
            </td>
            <!-- A status stands where its time is missing: no start (DNS,
                 not yet started) across Start and Finish, no finish (DNF,
                 on stage) under Finish. -->
            <td v-if="!run" colspan="2" class="text-center">
              <v-chip
                v-if="state"
                size="small"
                :color="state.color"
                :variant="state.color ? 'tonal' : 'text'"
              >
                {{ state.label }}
              </v-chip>
            </td>
            <template v-else>
              <td class="rg-time rg-timing text-no-wrap">
                {{ formatClockTime(run.startTime)
                }}<span class="rg-time-mark"
                  ><ManualMark v-if="run.startManual"
                /></span>
              </td>
              <td class="rg-time text-no-wrap">
                <template v-if="run.finishTime"
                  ><span class="rg-timing">{{
                    formatClockTime(run.finishTime)
                  }}</span
                  ><span class="rg-time-mark"
                    ><ManualMark v-if="run.finishManual" /></span
                ></template>
                <template v-else-if="state"
                  ><v-chip size="small" :color="state.color" variant="tonal">
                    {{ state.label }} </v-chip
                  ><span class="rg-time-mark"
                /></template>
              </td>
            </template>
            <td class="rg-time rg-timing text-no-wrap">
              <span v-if="notional" class="text-medium-emphasis"
                >({{ formatDuration(notional.durationMs) }})<span
                  class="rg-time-mark"
                  ><v-icon
                    size="x-small"
                    :icon="TIMING_MARKS.notional.icon" /></span
              ></span>
              <span
                v-else-if="run?.durationMs != null"
                :class="{
                  'text-timing-best font-weight-bold': rank?.gapMs === 0,
                }"
                >{{ formatDuration(run.durationMs)
                }}<span class="rg-time-mark"
                  ><v-icon
                    v-if="rank?.gapMs === 0"
                    size="x-small"
                    :icon="TIMING_MARKS.best.icon" /></span
              ></span>
            </td>
            <td class="rg-time rg-timing">{{ rank?.position ?? '' }}</td>
            <td class="rg-time rg-timing">
              {{ rank ? formatGap(rank.gapMs) : '' }}
            </td>
          </tr>
          <tr v-if="stageRows.length === 0">
            <td colspan="6" class="rg-empty">No stages yet.</td>
          </tr>
        </tbody>
        <tfoot v-if="legendMarks.length > 0">
          <tr>
            <td colspan="6"><TableLegend :marks="legendMarks" /></td>
          </tr>
        </tfoot>
      </v-table>
    </v-card>
  </template>

  <EntryDialog
    v-model="dialogOpen"
    :entry="entry"
    :classes="classes"
    :entries="entries"
    @saved="refresh"
  />
</template>

<style scoped>
/* Overall position, total and gap: large and centred above the stages,
   one face and size for all three so they read as one line. */
.rg-standing {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 16px 56px;
  margin: 0;
  text-align: center;
}
.rg-standing dt {
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.rg-standing dd {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.2;
}
/* Edit sits level with the top of the plate, as in every card header. */
.rg-entry-head :deep(.v-card-item__append) {
  align-self: flex-start;
}
/* Large on a desk, down to what still fits beside Edit on a phone: a
   crew name never wraps (PersonName), so it would be cut off instead. */
.rg-head-number {
  font-size: clamp(2rem, 8vw, 3rem);
}
.rg-head-crew {
  font-size: clamp(1rem, 4vw, 1.75rem);
}
/* Crew, Car and Registration side by side, a row of them equally tall; stacked
   as the screen narrows. */
.rg-entry-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
.rg-flag {
  height: 0.9em;
  aspect-ratio: 4 / 3;
  outline: 1px solid rgb(var(--v-theme-on-surface), 0.25);
}
</style>
