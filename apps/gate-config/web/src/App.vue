<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  LocaleMenu,
  logoUrl,
  notify,
  RallyFeedback,
  REPO_URL,
  useConfirm,
} from '@rally-gate/ui';

import {
  type ChronyState,
  NTP_OFFSET_WARN_THRESHOLD_MS,
} from '@rally-gate/shared';

import type {
  CommandResult,
  DecoderStatus,
  DeviceStatus,
  FieldDescriptor as FieldSpec,
  FieldError,
  WifiError,
  WifiNetwork,
} from '../../src/api-types';

interface NetworkState {
  available: boolean;
  wifi: DeviceStatus | null;
  networks: WifiNetwork[];
}

const fields = ref<Record<string, FieldSpec>>({});
const values = ref<Record<string, string>>({});
const errors = ref<Record<string, FieldError>>({});
const status = ref<{
  agent: CommandResult;
  clock: CommandResult;
  /** null off a Pi, or when chrony doesn't answer. */
  sync: ChronyState | null;
  log: CommandResult;
  version: string;
} | null>(null);

const saving = ref(false);
// null until Vuetify has validated; only an explicit false means "known bad",
// so the button is never disabled just because nothing has been touched yet.
const formValid = ref<boolean | null>(null);
const originalGateId = ref('');

const network = ref<NetworkState | null>(null);
const joinSsid = ref('');
const joinPassword = ref('');
const joining = ref(false);
const scanning = ref(false);
const wifiErrors = ref<Record<string, WifiError>>({});

const confirm = useConfirm();
const { t } = useI18n();

/** The server sends a field's rules only; its words are here, by name. */
const fieldText = (name: string, part: 'label' | 'hint' | 'message') =>
  t(`fields.${name}.${part}`);

function serverError(name: string): string | undefined {
  const code = errors.value[name];
  if (!code) return undefined;
  return code === 'invalid'
    ? fieldText(name, 'message')
    : t(`fieldError.${code}`);
}

const wifiError = (field: 'ssid' | 'password') =>
  wifiErrors.value[field] && t(`wifiError.${wifiErrors.value[field]}`);

let statusTimer: ReturnType<typeof setInterval> | undefined;

const decoder = ref<DecoderStatus | null>(null);
let decoderTimer: ReturnType<typeof setInterval> | undefined;

const agentOnline = computed(() => status.value?.agent.output === 'active');

// Wording, icons and threshold as the dashboard's GateClockChips.
const clockChip = computed(() => {
  const sync = status.value?.sync;
  if (!sync) return null;
  if (!sync.ntpSynced) {
    return {
      color: 'error',
      icon: 'mdi-crosshairs-off',
      text: t('gateConfig.clockNotSynced'),
    };
  }
  return {
    color:
      sync.ntpOffsetMs >= NTP_OFFSET_WARN_THRESHOLD_MS ? 'warning' : 'success',
    icon: 'mdi-target',
    text: t('gateConfig.clockAccuracy', { ms: sync.ntpOffsetMs.toFixed(1) }),
  };
});

// The saved id, deliberately, not what is currently typed in the field: this
// names which gate you are looking at, and following keystrokes would claim the
// gate had been renamed before it was. The pending change is shown by the
// warning below instead.
const gateName = computed(
  () => originalGateId.value || t('gateConfig.unconfigured'),
);

// A marshal opens one of these per gate, so several tabs end up side by side
// with otherwise identical titles. Gate first, since a narrow tab truncates the
// end.
watchEffect(() => {
  document.title = originalGateId.value
    ? `${originalGateId.value} · ${t('gateConfig.title')}`
    : t('gateConfig.title');
});

// Which card a setting belongs in is decided in config-file.ts, not here, so a
// new field cannot end up in the wrong one — or in none at all, which is what
// a hand-maintained list in this component would eventually do.
// A decoder's own settings show only while it is selected. Hidden ones keep
// their values, so switching back and forth loses nothing. Empty ADAPTER is
// gate-agent's default, the simulator.
function fieldsIn(group: 'general' | 'decoder') {
  const adapter = values.value.ADAPTER || 'simulated';
  return Object.entries(fields.value).filter(
    ([, spec]) =>
      (spec.group ?? 'general') === group &&
      (!spec.adapter || spec.adapter === adapter),
  );
}

// Changing GATE_ID is not a rename on the server — it keys Gate, GateAssignment
// and every stored detection, so the old rows stay behind and this gate comes
// back as a new, unassigned one. Warned before saving rather than after.
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
function rulesFor(name: string, spec: FieldSpec): Rule[] {
  const message = () => fieldText(name, 'message');
  const pattern = spec.pattern ? new RegExp(spec.pattern) : undefined;
  return [
    (value: unknown) => {
      const text = String(value ?? '');
      if (text === '') {
        return true;
      }
      if (pattern && !pattern.test(text)) {
        return message();
      }
      if (spec.oneOf && !spec.oneOf.includes(text)) {
        return message();
      }
      if (spec.range) {
        const parsed = Number(text);
        const [min, max] = spec.range;
        if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
          return message();
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

// The scan only happens on this request, so a network switched on after the
// page loaded needs a way to show up without a reload.
async function rescan() {
  scanning.value = true;
  try {
    await loadNetwork();
  } finally {
    scanning.value = false;
  }
}

async function join() {
  joining.value = true;
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
      notify(t('gateConfig.joinCheck'), true);
      return;
    }
    if (result.joined) {
      notify(t('gateConfig.joined', { ssid: joinSsid.value }));
    } else {
      notify(result.output || t('gateConfig.joinFailed'), true);
    }
    joinPassword.value = '';
    await loadNetwork();
  } catch {
    // Expected whenever the page is being read over the gate's own hotspot:
    // joining takes that hotspot down, so the reply has no route back. Saying
    // "failed" here would send a marshal to re-enter a password that is in fact
    // being used.
    notify(t('gateConfig.lostWhileJoining', { ssid: joinSsid.value }));
  } finally {
    joining.value = false;
  }
}

async function resetWifi() {
  if (
    !(await confirm({
      title: t('gateConfig.resetTitle'),
      text: t('gateConfig.resetText'),
      confirmText: t('gateConfig.resetConfirm'),
      color: 'error',
    }))
  )
    return;
  try {
    const result = await (
      await fetch('/api/network/reset', { method: 'POST' })
    ).json();
    if (result.started) {
      notify(t('gateConfig.resetDone'));
    } else {
      notify(result.output || t('gateConfig.hotspotFailed'), true);
    }
    await loadNetwork();
  } catch {
    notify(t('gateConfig.lostAfterReset'));
  }
}

async function powerOff() {
  if (
    !(await confirm({
      title: t('gateConfig.shutDownTitle'),
      text: t('gateConfig.shutDownText'),
      confirmText: t('gateConfig.shutDownGate'),
      color: 'error',
    }))
  )
    return;
  try {
    const result = await (
      await fetch('/api/power-off', { method: 'POST' })
    ).json();
    if (!result.started) {
      notify(result.output || t('gateConfig.shutDownFailed'), true);
      return;
    }
    notify(t('gateConfig.shuttingDown'));
  } catch {
    // The gate may take the network down before the reply gets out.
    notify(t('gateConfig.shuttingDown'));
  }
  // Polling a gate that is going away would only flip the chip to "unknown".
  clearInterval(statusTimer);
  clearInterval(decoderTimer);
}

async function loadStatus() {
  try {
    status.value = await (await fetch('/api/status')).json();
  } catch {
    status.value = null;
  }
}

async function loadDecoder() {
  try {
    decoder.value = await (await fetch('/api/decoder')).json();
  } catch {
    decoder.value = null;
  }
}

// Every second, matching OpenStint's own status rate, so moving a transponder
// over the loop shows at once — but only while OpenStint is the selected decoder.
watch(
  () => values.value.ADAPTER === 'openstint',
  (openstint) => {
    clearInterval(decoderTimer);
    decoder.value = null;
    if (!openstint) return;
    loadDecoder();
    decoderTimer = setInterval(loadDecoder, 1000);
  },
  { immediate: true },
);

async function save() {
  saving.value = true;
  errors.value = {};
  try {
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values.value),
    }).catch(() => null);
    if (!response) {
      notify(t('gateConfig.unreachable'), true);
      return;
    }
    const result = await response.json();
    if (!response.ok) {
      errors.value = result.errors ?? {};
      notify(
        result.error === 'writeFailed'
          ? t('gateConfig.writeFailed', { detail: result.detail })
          : t('gateConfig.notSaved'),
        true,
      );
      return;
    }
    // Saved and applied are separate outcomes: the file is already written by
    // the time a restart can fail, and telling a marshal "not saved" then would
    // send them to re-enter values that are in fact stored.
    const failed = [
      !result.restart.ok
        ? t('gateConfig.restartFailed', { output: result.restart.output })
        : null,
      !result.time.ok
        ? t('gateConfig.timeFailed', { output: result.time.output })
        : null,
    ].filter(Boolean);
    if (failed.length) {
      notify(
        t('gateConfig.savedButFailed', {
          failed: failed.join(t('gateConfig.and')),
        }),
        true,
      );
    } else {
      notify(t('gateConfig.saved'));
    }
    originalGateId.value = values.value.GATE_ID ?? '';
    await loadStatus();
  } catch {
    // The gate answered, but not as expected: whether it saved is unknown.
    notify(t('ui.somethingWentWrong'), true);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await load();
  await Promise.all([loadStatus(), loadNetwork()]);
  statusTimer = setInterval(loadStatus, 5000);
});
onUnmounted(() => {
  clearInterval(statusTimer);
  clearInterval(decoderTimer);
});
</script>

<template>
  <v-app>
    <v-app-bar>
      <v-app-bar-title>
        <div class="d-flex align-center ga-3">
          <img :src="logoUrl" alt="" class="app-bar-logo" />
          <div class="app-bar-text">
            <div class="text-caption text-medium-emphasis app-bar-label">
              {{ t('gateConfig.title') }}
            </div>
            <div class="text-subtitle-1 font-weight-medium app-bar-gate">
              {{ gateName }}
            </div>
          </div>
        </div>
      </v-app-bar-title>
      <template #append>
        <LocaleMenu />
        <!-- Paired with text, not colour alone: the same colourblind rule the
             timing values follow (see packages/ui/theme.ts). -->
        <v-chip
          :color="agentOnline ? 'success' : 'error'"
          :prepend-icon="agentOnline ? 'mdi-check-circle' : 'mdi-alert-circle'"
          size="small"
          variant="flat"
        >
          {{
            agentOnline
              ? t('gateConfig.running')
              : (status?.agent.output ?? t('gateConfig.unknown'))
          }}
        </v-chip>
      </template>
    </v-app-bar>

    <v-main>
      <v-container class="py-6" style="max-width: 720px">
        <!-- Status first: in the field a gate's page is opened to check it or
             to fix its Wi-Fi; settings are set once. Same order as the ESP32
             gate's page (firmware/esp32-gate/web/index.html). -->
        <v-card class="mb-6">
          <v-card-title>{{ t('gateConfig.status') }}</v-card-title>
          <v-card-text>
            <dl class="rg-facts">
              <dt>{{ t('gateConfig.agent') }}</dt>
              <dd>
                <v-chip
                  :color="agentOnline ? 'success' : 'error'"
                  :prepend-icon="
                    agentOnline ? 'mdi-check-circle' : 'mdi-alert-circle'
                  "
                  size="small"
                  variant="flat"
                >
                  {{
                    agentOnline
                      ? t('gateConfig.running')
                      : (status?.agent.output ?? t('gateConfig.unknown'))
                  }}
                </v-chip>
              </dd>
              <dt>{{ t('gateConfig.clock') }}</dt>
              <dd>
                <v-chip
                  v-if="clockChip"
                  :color="clockChip.color"
                  :prepend-icon="clockChip.icon"
                  size="small"
                  variant="flat"
                >
                  {{ clockChip.text }}
                </v-chip>
                <span v-else class="text-medium-emphasis">
                  {{ t('gateConfig.unavailable') }}
                </span>
              </dd>
              <dt>{{ t('gateConfig.version') }}</dt>
              <dd class="rg-timing">
                {{ status?.version ?? t('gateConfig.unavailable') }}
                <a
                  :href="REPO_URL"
                  target="_blank"
                  class="text-medium-emphasis ml-2"
                  :aria-label="t('gateConfig.onGithub')"
                >
                  <v-icon icon="mdi-github" size="small" />
                </a>
              </dd>
            </dl>

            <!-- mt, not mb on the dl: .rg-facts resets its own margin. -->
            <div class="text-medium-emphasis text-caption mt-6 mb-1">
              {{ t('gateConfig.clockDetails') }}
            </div>
            <pre class="rg-timing status-block mb-4">{{
              status?.clock.output || t('gateConfig.unavailable')
            }}</pre>

            <div class="text-medium-emphasis text-caption mb-1">
              {{ t('gateConfig.recentLog') }}
            </div>
            <pre class="status-block">{{
              status?.log.output || t('gateConfig.unavailable')
            }}</pre>
          </v-card-text>
          <v-card-actions>
            <v-btn variant="text" prepend-icon="mdi-power" @click="powerOff">
              {{ t('gateConfig.shutDown') }}
            </v-btn>
          </v-card-actions>
        </v-card>

        <v-card class="mb-6">
          <v-card-title class="d-flex align-center">
            {{ t('gateConfig.network') }}
            <v-spacer />
            <v-chip
              v-if="wifiConnection"
              :color="onHotspot ? 'warning' : 'success'"
              :prepend-icon="onHotspot ? 'mdi-access-point' : 'mdi-wifi'"
              size="small"
              variant="flat"
            >
              {{ onHotspot ? t('gateConfig.ownHotspot') : wifiConnection }}
            </v-chip>
            <v-chip
              v-else
              color="error"
              prepend-icon="mdi-wifi-off"
              size="small"
              variant="flat"
            >
              {{ t('gateConfig.noWifi') }}
            </v-chip>
          </v-card-title>
          <v-card-text>
            <v-alert
              v-if="network && !network.available"
              type="info"
              variant="tonal"
              density="comfortable"
              :text="t('gateConfig.noNetworkManager')"
              class="mb-2"
            />
            <template v-else>
              <!-- A combobox, not a select: a hidden network broadcasts no SSID,
                   so it never appears in the scan and has to be typed. -->
              <v-combobox
                v-model="joinSsid"
                :items="network?.networks.map((n) => n.ssid) ?? []"
                :error-messages="wifiError('ssid')"
                :label="t('gateConfig.network')"
                :hint="t('gateConfig.networkHint')"
                persistent-hint
                class="mb-4"
              />
              <!-- Under the field, as on the ESP32 gate's page. -->
              <v-btn
                :loading="scanning"
                variant="text"
                prepend-icon="mdi-refresh"
                class="mt-n2 mb-4"
                @click="rescan"
              >
                {{ t('gateConfig.rescan') }}
              </v-btn>
              <v-text-field
                v-if="selectedSecured"
                v-model="joinPassword"
                :error-messages="wifiError('password')"
                :label="t('gateConfig.wifiPassword')"
                type="password"
                autocomplete="off"
                :hint="t('gateConfig.wifiPasswordHint')"
                persistent-hint
                class="mb-4"
              />

              <v-alert
                v-if="onHotspot"
                type="info"
                variant="tonal"
                density="comfortable"
                :text="t('gateConfig.onHotspot')"
              />
            </template>
          </v-card-text>
          <v-card-actions v-if="network?.available">
            <v-btn
              variant="text"
              prepend-icon="mdi-wifi-remove"
              @click="resetWifi"
            >
              {{ t('gateConfig.resetWifi') }}
            </v-btn>
            <v-spacer />
            <v-btn
              :loading="joining"
              :disabled="!joinSsid"
              color="primary"
              variant="flat"
              @click="join"
            >
              {{ t('gateConfig.join') }}
            </v-btn>
          </v-card-actions>
        </v-card>

        <!-- One form across both cards: they are two halves of the same PUT, so
             the save button sits after them rather than in either one. -->
        <v-form v-model="formValid">
          <v-card class="mb-6">
            <v-card-title>{{ t('gateConfig.settings') }}</v-card-title>
            <v-card-text>
              <template v-for="[name, spec] in fieldsIn('general')" :key="name">
                <v-text-field
                  v-model="values[name]"
                  :label="fieldText(name, 'label')"
                  :hint="fieldText(name, 'hint')"
                  :rules="rulesFor(name, spec)"
                  :error-messages="serverError(name)"
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
                :text="t('gateConfig.gateIdChanged')"
              />
            </v-card-text>
          </v-card>

          <!-- Separate from the settings above because it is the one group that
               changes with the hardware in the box rather than with the rally. -->
          <v-card class="mb-6">
            <v-card-title>{{ t('gateConfig.decoder') }}</v-card-title>
            <v-card-text>
              <template v-for="[name, spec] in fieldsIn('decoder')" :key="name">
                <v-select
                  v-if="spec.oneOf"
                  v-model="values[name]"
                  :items="spec.oneOf"
                  :label="fieldText(name, 'label')"
                  :hint="fieldText(name, 'hint')"
                  :rules="rulesFor(name, spec)"
                  :error-messages="serverError(name)"
                  persistent-hint
                  class="mb-4"
                  @update:model-value="clearServerError(name)"
                />
                <v-text-field
                  v-else
                  v-model="values[name]"
                  :label="fieldText(name, 'label')"
                  :hint="fieldText(name, 'hint')"
                  :rules="rulesFor(name, spec)"
                  :error-messages="serverError(name)"
                  persistent-hint
                  class="mb-4"
                  @update:model-value="clearServerError(name)"
                />
              </template>
              <template v-if="decoder">
                <div class="text-medium-emphasis text-caption mb-1">
                  {{ t('gateConfig.decoderSignal') }}
                </div>
                <!-- OpenStint reports once a second; older means it stopped. -->
                <div v-if="decoder.ageMs > 3000" class="text-warning mb-4">
                  {{
                    t('gateConfig.decoderStale', {
                      seconds: Math.round(decoder.ageMs / 1000),
                    })
                  }}
                </div>
                <div v-else class="mb-4">
                  <div class="rg-timing">
                    {{
                      t('gateConfig.decoderNoise', {
                        value: decoder.noisePower.toFixed(1),
                      })
                    }}
                  </div>
                  <div class="rg-timing">
                    {{
                      t('gateConfig.decoderFrames', {
                        processed: decoder.framesProcessed,
                        received: decoder.framesReceived,
                      })
                    }}
                  </div>
                  <div class="rg-timing">
                    {{
                      t('gateConfig.decoderDc', {
                        value: decoder.dcOffset.toFixed(2),
                      })
                    }}
                  </div>
                  <div class="text-medium-emphasis text-caption mt-1">
                    {{ t('gateConfig.decoderHint') }}
                  </div>
                </div>
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
              {{ t('gateConfig.saveAndApply') }}
            </v-btn>
          </div>
        </v-form>
      </v-container>
    </v-main>
    <RallyFeedback />
  </v-app>
</template>

<style scoped>
/* Two lines inside the default 64px bar, so the tighter leading is needed. The
   gate id is the part that must stay readable when the status chip squeezes the
   title on a phone, so the label is what gets truncated. */
.app-bar-label {
  line-height: 1.1;
}
.app-bar-logo {
  height: 22px;
  flex-shrink: 0;
}
.app-bar-text {
  min-width: 0;
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
