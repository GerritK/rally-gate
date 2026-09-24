<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

interface FieldSpec {
  label: string;
  hint?: string;
  oneOf?: readonly string[];
}
interface CommandResult {
  ok: boolean;
  output: string;
}

const fields = ref<Record<string, FieldSpec>>({});
const values = ref<Record<string, string>>({});
const errors = ref<Record<string, string>>({});
const status = ref<{
  agent: CommandResult;
  clock: CommandResult;
  log: CommandResult;
} | null>(null);

const saving = ref(false);
const notice = ref<{
  type: 'success' | 'error' | 'warning';
  text: string;
} | null>(null);
const originalGateId = ref('');

let statusTimer: ReturnType<typeof setInterval> | undefined;

const agentOnline = computed(() => status.value?.agent.output === 'active');

// Changing GATE_ID is not a rename on the server — it keys Gate, GateAssignment
// and every stored detection, so the old rows stay behind and this gate comes
// back as a new, unassigned one. Warned before saving rather than after.
const gateIdChanged = computed(
  () => !!originalGateId.value && values.value.GATE_ID !== originalGateId.value,
);

async function load() {
  fields.value = await (await fetch('/api/fields')).json();
  const config = await (await fetch('/api/config')).json();
  values.value = Object.fromEntries(
    Object.keys(fields.value).map((key) => [key, config[key] ?? '']),
  );
  originalGateId.value = config.GATE_ID ?? '';
}

async function loadStatus() {
  try {
    status.value = await (await fetch('/api/status')).json();
  } catch {
    status.value = null;
  }
}

async function save() {
  saving.value = true;
  notice.value = null;
  errors.value = {};
  try {
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values.value),
    });
    const result = await response.json();
    if (!response.ok) {
      errors.value = result.errors ?? {};
      notice.value = {
        type: 'error',
        text: result.message ?? 'Nothing was saved — check the fields below.',
      };
      return;
    }
    // Saved and applied are separate outcomes: the file is already written by
    // the time a restart can fail, and telling a marshal "not saved" then would
    // send them to re-enter values that are in fact stored.
    const failed = [
      !result.restart.ok ? 'restarting gate-agent' : null,
      !result.time.ok ? 'updating the time source' : null,
    ].filter(Boolean);
    notice.value = failed.length
      ? { type: 'warning', text: `Saved, but ${failed.join(' and ')} failed.` }
      : { type: 'success', text: 'Saved and applied.' };
    originalGateId.value = values.value.GATE_ID ?? '';
    await loadStatus();
  } catch (err) {
    notice.value = { type: 'error', text: `Could not reach the gate: ${err}` };
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await load();
  await loadStatus();
  statusTimer = setInterval(loadStatus, 5000);
});
onUnmounted(() => clearInterval(statusTimer));
</script>

<template>
  <v-app>
    <v-app-bar flat>
      <v-app-bar-title>Gate Config</v-app-bar-title>
      <template #append>
        <!-- Paired with text, not colour alone: the same colourblind rule the
             timing values follow (see packages/ui/theme.ts). -->
        <v-chip
          :color="agentOnline ? 'success' : 'error'"
          :prepend-icon="agentOnline ? 'mdi-check-circle' : 'mdi-alert-circle'"
          size="small"
          variant="flat"
        >
          {{ agentOnline ? 'running' : (status?.agent.output ?? 'unknown') }}
        </v-chip>
      </template>
    </v-app-bar>

    <v-main>
      <v-container class="py-6" style="max-width: 720px">
        <v-alert
          v-if="notice"
          :type="notice.type"
          :text="notice.text"
          class="mb-4"
          closable
          @click:close="notice = null"
        />

        <v-card class="mb-6">
          <v-card-title>Settings</v-card-title>
          <v-card-text>
            <template v-for="(spec, name) in fields" :key="name">
              <v-select
                v-if="spec.oneOf"
                v-model="values[name]"
                :items="[...spec.oneOf]"
                :label="spec.label"
                :hint="spec.hint"
                :error-messages="errors[name]"
                persistent-hint
                class="mb-4"
              />
              <v-text-field
                v-else
                v-model="values[name]"
                :label="spec.label"
                :hint="spec.hint"
                :error-messages="errors[name]"
                persistent-hint
                class="mb-4"
              />
            </template>

            <v-alert
              v-if="gateIdChanged"
              type="warning"
              variant="tonal"
              density="comfortable"
              text="Changing the Gate ID makes this a different gate to the server. Its
                    existing assignment and recorded detections stay with the old ID."
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              :loading="saving"
              color="primary"
              variant="flat"
              @click="save"
            >
              Save and apply
            </v-btn>
          </v-card-actions>
        </v-card>

        <v-card>
          <v-card-title>Status</v-card-title>
          <v-card-text>
            <div class="text-medium-emphasis text-caption mb-1">Clock</div>
            <pre class="rg-timing status-block mb-4">{{
              status?.clock.output || 'unavailable'
            }}</pre>

            <div class="text-medium-emphasis text-caption mb-1">
              Recent gate-agent log
            </div>
            <pre class="status-block">{{
              status?.log.output || 'unavailable'
            }}</pre>
          </v-card-text>
        </v-card>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
/* Shown verbatim rather than parsed into fields: log text is not an interface,
   and a regex over it breaks the next time a message is reworded. */
.status-block {
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  opacity: 0.85;
}
</style>
