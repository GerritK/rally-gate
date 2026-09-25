<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';

// Mirrors FieldDescriptor in ../../src/config-file.ts, which is where the rules
// are actually defined. Rebuilt here into input rules rather than restated, so
// the browser cannot enforce a grammar the server does not have.
interface FieldSpec {
  label: string;
  hint?: string;
  message: string;
  group?: 'general' | 'decoder';
  oneOf?: string[];
  pattern?: string;
  range?: [number, number];
}
interface CommandResult {
  ok: boolean;
  output: string;
}

interface WifiNetwork {
  ssid: string;
  signal: number;
  secured: boolean;
  inUse: boolean;
}
interface NetworkState {
  available: boolean;
  wifi: { device: string; state: string; connection: string } | null;
  networks: WifiNetwork[];
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
// null until Vuetify has validated; only an explicit false means "known bad",
// so the button is never disabled just because nothing has been touched yet.
const formValid = ref<boolean | null>(null);
const notice = ref<{
  type: 'success' | 'error' | 'warning';
  text: string;
} | null>(null);
const originalGateId = ref('');

const network = ref<NetworkState | null>(null);
const joinSsid = ref('');
const joinPassword = ref('');
const joining = ref(false);
const wifiErrors = ref<Record<string, string>>({});

let statusTimer: ReturnType<typeof setInterval> | undefined;

const agentOnline = computed(() => status.value?.agent.output === 'active');

// The saved id, deliberately, not what is currently typed in the field: this
// names which gate you are looking at, and following keystrokes would claim the
// gate had been renamed before it was. The pending change is shown by the
// warning below instead.
const gateName = computed(() => originalGateId.value || 'unconfigured gate');

// A marshal opens one of these per gate, so several tabs end up side by side
// with otherwise identical titles. Gate first, since a narrow tab truncates the
// end.
watchEffect(() => {
  document.title = originalGateId.value
    ? `${originalGateId.value} - Gate Config`
    : 'Gate Config';
});

// Changing GATE_ID is not a rename on the server — it keys Gate, GateAssignment
// and every stored detection, so the old rows stay behind and this gate comes
// back as a new, unassigned one. Warned before saving rather than after.
// Which card a setting belongs in is decided in config-file.ts, not here, so a
// new field cannot end up in the wrong one — or in none at all, which is what
// a hand-maintained list in this component would eventually do.
function fieldsIn(group: 'general' | 'decoder') {
  return Object.entries(fields.value).filter(
    ([, spec]) => (spec.group ?? 'general') === group,
  );
}

const gateIdChanged = computed(
  () => !!originalGateId.value && values.value.GATE_ID !== originalGateId.value,
);

const wifiConnection = computed(() => {
  const wifi = network.value?.wifi;
  if (!wifi) {
    return null;
  }
  // nmcli leaves CONNECTION empty for a radio that is up but not associated,
  // which reads as "no network" rather than as a nameless one.
  if (wifi.state !== 'connected' || !wifi.connection) {
    return null;
  }
  return network.value?.networks.find((n) => n.inUse)?.ssid ?? wifi.connection;
});

// The gate is serving its own access point, which means whoever is reading this
// is almost certainly on it — so joining a network will drop them.
const onHotspot = computed(
  () => network.value?.wifi?.connection === 'rally-gate-hotspot',
);

const selectedSecured = computed(() => {
  const match = network.value?.networks.find((n) => n.ssid === joinSsid.value);
  // An SSID typed by hand (hidden network) is assumed secured: offering no
  // password field for it would make it unjoinable.
  return match ? match.secured : true;
});

type Rule = (value: unknown) => true | string;

/**
 * Immediate feedback only. Every rule here is derived from the descriptor the
 * server sent, and the server re-checks all of it on save — see `validate` in
 * config-file.ts. An empty value passes: absent means "leave unset", and which
 * fields are required is not a grammar question.
 */
function rulesFor(spec: FieldSpec): Rule[] {
  const pattern = spec.pattern ? new RegExp(spec.pattern) : undefined;
  return [
    (value: unknown) => {
      const text = String(value ?? '');
      if (text === '') {
        return true;
      }
      if (pattern && !pattern.test(text)) {
        return spec.message;
      }
      if (spec.oneOf && !spec.oneOf.includes(text)) {
        return spec.message;
      }
      if (spec.range) {
        const parsed = Number(text);
        const [min, max] = spec.range;
        if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
          return spec.message;
        }
      }
      return true;
    },
  ];
}

// A server-side error refers to the value that was submitted, so it stops being
// true the moment the field is edited. Left in place it would sit under a field
// the marshal has already corrected.
function clearServerError(name: string) {
  delete errors.value[name];
}

async function load() {
  fields.value = await (await fetch('/api/fields')).json();
  const config = await (await fetch('/api/config')).json();
  values.value = Object.fromEntries(
    Object.keys(fields.value).map((key) => [key, config[key] ?? '']),
  );
  originalGateId.value = config.GATE_ID ?? '';
}

async function loadNetwork() {
  try {
    network.value = await (await fetch('/api/network')).json();
  } catch {
    network.value = null;
  }
}

async function join() {
  joining.value = true;
  notice.value = null;
  wifiErrors.value = {};
  try {
    const response = await fetch('/api/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ssid: joinSsid.value,
        password: joinPassword.value,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      wifiErrors.value = result.errors ?? {};
      notice.value = { type: 'error', text: 'Could not join — check below.' };
      return;
    }
    notice.value = result.joined
      ? { type: 'success', text: `Joined ${joinSsid.value}.` }
      : {
          type: 'error',
          text: result.output || 'Could not join that network.',
        };
    joinPassword.value = '';
    await loadNetwork();
  } catch {
    // Expected whenever the page is being read over the gate's own hotspot:
    // joining takes that hotspot down, so the reply has no route back. Saying
    // "failed" here would send a marshal to re-enter a password that is in fact
    // being used.
    notice.value = {
      type: 'warning',
      text: `Lost contact with the gate while joining ${joinSsid.value}. That is expected if you were connected to its hotspot — reconnect to ${joinSsid.value} and reopen this page. If the gate cannot join, it raises its hotspot again within a minute.`,
    };
  } finally {
    joining.value = false;
  }
}

async function raiseHotspot() {
  notice.value = null;
  try {
    const result = await (
      await fetch('/api/network/hotspot', { method: 'POST' })
    ).json();
    notice.value = result.started
      ? { type: 'success', text: 'Hotspot up.' }
      : {
          type: 'error',
          text: result.output || 'Could not start the hotspot.',
        };
    await loadNetwork();
  } catch {
    notice.value = {
      type: 'warning',
      text: 'Lost contact with the gate — expected if it dropped the network you were on to raise the hotspot.',
    };
  }
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
      !result.restart.ok
        ? `restarting gate-agent (${result.restart.output})`
        : null,
      !result.time.ok
        ? `updating the time source (${result.time.output})`
        : null,
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
  await Promise.all([loadStatus(), loadNetwork()]);
  statusTimer = setInterval(loadStatus, 5000);
});
onUnmounted(() => clearInterval(statusTimer));
</script>

<template>
  <v-app>
    <v-app-bar flat>
      <v-app-bar-title>
        <div class="text-caption text-medium-emphasis app-bar-label">
          Gate Config
        </div>
        <div class="text-subtitle-1 font-weight-medium app-bar-gate">
          {{ gateName }}
        </div>
      </v-app-bar-title>
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

        <!-- One form across both cards: they are two halves of the same PUT, so
             the save button sits after them rather than in either one. -->
        <v-form v-model="formValid">
          <v-card class="mb-6">
            <v-card-title>Settings</v-card-title>
            <v-card-text>
              <template v-for="[name, spec] in fieldsIn('general')" :key="name">
                <v-text-field
                  v-model="values[name]"
                  :label="spec.label"
                  :hint="spec.hint"
                  :rules="rulesFor(spec)"
                  :error-messages="errors[name]"
                  persistent-hint
                  class="mb-4"
                  @update:model-value="clearServerError(name)"
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
          </v-card>

          <!-- Separate from the settings above because it is the one group that
               changes with the hardware in the box rather than with the rally,
               and because everything in it but the decoder itself disappears
               once an adapter other than the simulator exists. -->
          <v-card class="mb-6">
            <v-card-title>Decoder</v-card-title>
            <v-card-text>
              <template v-for="[name, spec] in fieldsIn('decoder')" :key="name">
                <v-select
                  v-if="spec.oneOf"
                  v-model="values[name]"
                  :items="spec.oneOf"
                  :label="spec.label"
                  :hint="spec.hint"
                  :rules="rulesFor(spec)"
                  :error-messages="errors[name]"
                  persistent-hint
                  class="mb-4"
                  @update:model-value="clearServerError(name)"
                />
                <v-text-field
                  v-else
                  v-model="values[name]"
                  :label="spec.label"
                  :hint="spec.hint"
                  :rules="rulesFor(spec)"
                  :error-messages="errors[name]"
                  persistent-hint
                  class="mb-4"
                  @update:model-value="clearServerError(name)"
                />
              </template>
            </v-card-text>
          </v-card>

          <div class="d-flex justify-end mb-6">
            <v-btn
              :loading="saving"
              :disabled="formValid === false"
              color="primary"
              variant="flat"
              @click="save"
            >
              Save and apply
            </v-btn>
          </div>
        </v-form>

        <v-card class="mb-6">
          <v-card-title class="d-flex align-center">
            Network
            <v-spacer />
            <v-chip
              v-if="wifiConnection"
              :color="onHotspot ? 'warning' : 'success'"
              :prepend-icon="onHotspot ? 'mdi-access-point' : 'mdi-wifi'"
              size="small"
              variant="flat"
            >
              {{ onHotspot ? 'own hotspot' : wifiConnection }}
            </v-chip>
            <v-chip
              v-else
              color="error"
              prepend-icon="mdi-wifi-off"
              size="small"
              variant="flat"
            >
              no Wi-Fi
            </v-chip>
          </v-card-title>
          <v-card-text>
            <v-alert
              v-if="network && !network.available"
              type="info"
              variant="tonal"
              density="comfortable"
              text="NetworkManager is not available on this machine, so Wi-Fi cannot be
                    configured from here. Expected off a Raspberry Pi, or on a gate
                    wired by Ethernet."
              class="mb-2"
            />
            <template v-else>
              <!-- A combobox, not a select: a hidden network broadcasts no SSID,
                   so it never appears in the scan and has to be typed. -->
              <v-combobox
                v-model="joinSsid"
                :items="network?.networks.map((n) => n.ssid) ?? []"
                :error-messages="wifiErrors.ssid"
                label="Network"
                hint="Pick one in range, or type the name of a hidden network."
                persistent-hint
                class="mb-4"
              />
              <v-text-field
                v-if="selectedSecured"
                v-model="joinPassword"
                :error-messages="wifiErrors.password"
                label="Wi-Fi password"
                type="password"
                autocomplete="off"
                hint="Stored by NetworkManager, not in the gate's config file."
                persistent-hint
                class="mb-4"
              />

              <v-alert
                v-if="onHotspot"
                type="info"
                variant="tonal"
                density="comfortable"
                text="You are connected to this gate's own hotspot. Joining a network
                      takes the hotspot down, so this page will go unreachable — that
                      is expected. If the gate cannot join, it raises the hotspot
                      again within a minute."
              />
            </template>
          </v-card-text>
          <v-card-actions v-if="network?.available">
            <!-- Raising it by hand is the only way to check the hotspot from
                 here: the watchdog fires only when the gate has no network. -->
            <v-btn
              variant="text"
              prepend-icon="mdi-access-point"
              @click="raiseHotspot"
            >
              Start hotspot
            </v-btn>
            <v-spacer />
            <v-btn
              :loading="joining"
              :disabled="!joinSsid"
              color="primary"
              variant="flat"
              @click="join"
            >
              Join
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
/* Two lines inside the default 64px bar, so the tighter leading is needed. The
   gate id is the part that must stay readable when the status chip squeezes the
   title on a phone, so the label is what gets truncated. */
.app-bar-label {
  line-height: 1.1;
}
.app-bar-gate {
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
