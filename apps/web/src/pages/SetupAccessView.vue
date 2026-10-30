<script setup lang="ts">
import {
  AccessRole,
  type AuthDevice,
  type Invitation,
} from '@rally-gate/shared';
import { t } from '@rally-gate/ui';
import { computed, onMounted, ref } from 'vue';
import {
  createInvitation,
  fetchDevices,
  fetchInvitations,
  fetchServerUrls,
  formatCode,
  session,
  setDeviceBlocked,
  setInvitationBlocked,
  setPassword,
} from '../api/auth';
import { ApiError } from '../api/client';
import { fetchStages, type Stage } from '../api/stages';
import FormDialog from '../components/FormDialog.vue';
import { formatStamp, required } from '../format';
import { printInvitations } from '../pdf';

const invitations = ref<Invitation[]>([]);
const devices = ref<AuthDevice[]>([]);
const stages = ref<Stage[]>([]);
const serverUrls = ref<string[]>([]);
const serverUrl = ref('');
/** Not the organiser: the lists are refused, so the page says why instead. */
const forbidden = ref(false);

const ROLES = Object.values(AccessRole);
const roleItems = computed(() =>
  ROLES.map((role) => ({
    value: role,
    title: t(`access.roles.${role}`),
    subtitle: t(`access.roleHints.${role}`),
  })),
);
const stageItems = computed(() =>
  stages.value.map((s) => ({ value: s.id, title: `${s.id} · ${s.name}` })),
);

const invitationLabel = computed(
  () => new Map(invitations.value.map((i) => [i.id, i.label])),
);
const deviceCount = (invitation: Invitation) =>
  devices.value.filter((d) => d.invitationId === invitation.id).length;

async function refresh() {
  try {
    [invitations.value, devices.value, serverUrls.value] = await Promise.all([
      fetchInvitations(),
      fetchDevices(),
      fetchServerUrls(),
    ]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      forbidden.value = true;
      return;
    }
    throw err;
  }
  if (!serverUrls.value.includes(serverUrl.value)) {
    serverUrl.value = serverUrls.value[0] ?? '';
  }
}

const dialogOpen = ref(false);
const draft = ref({
  label: '',
  role: AccessRole.STAGE_MARSHAL,
  stageIds: [] as string[],
});
const stagesRequired = (ids: string[]) =>
  draft.value.role !== AccessRole.STAGE_MARSHAL ||
  ids.length > 0 ||
  t('access.stagesRequired');

function openDialog() {
  draft.value = { label: '', role: AccessRole.STAGE_MARSHAL, stageIds: [] };
  dialogOpen.value = true;
}

async function onSave() {
  await createInvitation({
    label: draft.value.label.trim(),
    role: draft.value.role,
    stageIds:
      draft.value.role === AccessRole.STAGE_MARSHAL ? draft.value.stageIds : [],
  });
  await refresh();
}

async function toggleInvitation(invitation: Invitation) {
  await setInvitationBlocked(invitation.id, !invitation.blocked);
  await refresh();
}

async function toggleDevice(device: AuthDevice) {
  await setDeviceBlocked(device.id, !device.blocked);
  await refresh();
}

const passwordOpen = ref(false);
const passwordDraft = ref({ password: '' });
const minLength = (v: string) => v.length >= 8 || t('access.passwordMin');

function openPassword() {
  passwordDraft.value = { password: '' };
  passwordOpen.value = true;
}

const print = (list: Invitation[]) =>
  printInvitations(
    list.filter((i) => !i.blocked),
    serverUrl.value,
  );

onMounted(async () => {
  stages.value = await fetchStages();
  await refresh();
});
</script>

<template>
  <v-btn variant="text" prepend-icon="mdi-arrow-left" to="/setup" class="mb-4">
    {{ $t('setup.back') }}
  </v-btn>

  <v-alert v-if="forbidden" type="info" variant="tonal">
    {{ $t('access.organiserOnly') }}
    <template #append>
      <v-btn variant="text" to="/login">{{ $t('login.title') }}</v-btn>
    </template>
  </v-alert>

  <template v-else>
    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        {{ $t('access.invitations') }}
        <v-spacer />
        <v-btn
          variant="tonal"
          prepend-icon="mdi-printer-outline"
          class="mr-2"
          :disabled="!invitations.some((i) => !i.blocked)"
          @click="print(invitations)"
        >
          {{ $t('access.printAll') }}
        </v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openDialog">
          {{ $t('access.add') }}
        </v-btn>
      </v-card-title>
      <v-card-text>
        <p class="mb-4">{{ $t('access.explain') }}</p>
        <v-select
          v-if="serverUrls.length > 1"
          v-model="serverUrl"
          :items="serverUrls"
          :label="$t('access.serverUrl')"
          :hint="$t('access.serverUrlHint')"
          persistent-hint
          class="mb-4"
          style="max-width: 24rem"
        />
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('access.label') }}</th>
              <th>{{ $t('access.role') }}</th>
              <th>{{ $t('access.code') }}</th>
              <th>{{ $t('access.devices') }}</th>
              <th></th>
              <th width="1%"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="invitation in invitations" :key="invitation.id">
              <td>{{ invitation.label }}</td>
              <td>
                {{ $t(`access.roles.${invitation.role}`) }}
                <span
                  v-if="invitation.stageIds.length"
                  class="text-medium-emphasis"
                >
                  · {{ invitation.stageIds.join(', ') }}
                </span>
              </td>
              <td class="rg-timing">{{ formatCode(invitation.code) }}</td>
              <td>{{ deviceCount(invitation) }}</td>
              <td>
                <v-chip
                  v-if="invitation.blocked"
                  size="small"
                  color="error"
                  prepend-icon="mdi-cancel"
                >
                  {{ $t('access.blocked') }}
                </v-chip>
              </td>
              <td class="text-no-wrap">
                <v-btn
                  v-if="invitation.blocked"
                  size="small"
                  variant="text"
                  prepend-icon="mdi-lock-open-outline"
                  @click="toggleInvitation(invitation)"
                >
                  {{ $t('access.unblock') }}
                </v-btn>
                <template v-else>
                  <v-btn
                    size="small"
                    variant="text"
                    prepend-icon="mdi-printer-outline"
                    @click="print([invitation])"
                  >
                    {{ $t('access.print') }}
                  </v-btn>
                  <!-- Out of reach like Delete: it logs marshals out. -->
                  <v-menu>
                    <template #activator="{ props: menu }">
                      <v-btn
                        v-bind="menu"
                        icon="mdi-dots-vertical"
                        size="small"
                        variant="text"
                        :aria-label="
                          $t('common.moreFor', { name: invitation.label })
                        "
                      />
                    </template>
                    <v-list density="compact">
                      <v-list-item
                        prepend-icon="mdi-cancel"
                        :title="$t('access.block')"
                        base-color="error"
                        @click="toggleInvitation(invitation)"
                      />
                    </v-list>
                  </v-menu>
                </template>
              </td>
            </tr>
            <tr v-if="invitations.length === 0">
              <td colspan="6" class="rg-empty">
                {{ $t('access.empty', { action: $t('access.add') }) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <v-card class="mb-4">
      <v-card-title>{{ $t('access.devices') }}</v-card-title>
      <v-card-text>
        <v-table density="comfortable">
          <thead>
            <tr>
              <th>{{ $t('access.label') }}</th>
              <th>{{ $t('access.since') }}</th>
              <th></th>
              <th width="1%"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="device in devices" :key="device.id">
              <td>
                {{
                  device.invitationId
                    ? invitationLabel.get(device.invitationId)
                    : $t('access.passwordLogin')
                }}
                · {{ $t('access.device', { n: device.number }) }}
              </td>
              <td class="rg-timing">{{ formatStamp(device.createdAt) }}</td>
              <td>
                <v-chip
                  v-if="device.blocked"
                  size="small"
                  color="error"
                  prepend-icon="mdi-cancel"
                >
                  {{ $t('access.blocked') }}
                </v-chip>
              </td>
              <td class="text-no-wrap">
                <v-btn
                  size="small"
                  variant="text"
                  :prepend-icon="
                    device.blocked ? 'mdi-lock-open-outline' : 'mdi-cancel'
                  "
                  @click="toggleDevice(device)"
                >
                  {{
                    device.blocked ? $t('access.unblock') : $t('access.block')
                  }}
                </v-btn>
              </td>
            </tr>
            <tr v-if="devices.length === 0">
              <td colspan="4" class="rg-empty">
                {{ $t('access.devicesEmpty') }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <v-card>
      <v-card-title class="d-flex align-center">
        {{ $t('access.password') }}
        <v-chip
          size="small"
          class="ml-3"
          :color="session?.passwordSet ? 'success' : undefined"
        >
          {{
            session?.passwordSet
              ? $t('access.passwordIsSet')
              : $t('access.passwordNotSet')
          }}
        </v-chip>
        <v-spacer />
        <v-btn variant="tonal" prepend-icon="mdi-key" @click="openPassword">
          {{
            session?.passwordSet
              ? $t('access.changePassword')
              : $t('access.setPassword')
          }}
        </v-btn>
      </v-card-title>
      <v-card-text>{{ $t('access.passwordExplain') }}</v-card-text>
    </v-card>
  </template>

  <FormDialog
    v-model="dialogOpen"
    :title="$t('access.add')"
    :form="draft"
    :save="onSave"
    :saved="$t('access.added')"
    :save-text="$t('access.add')"
  >
    <v-text-field
      v-model="draft.label"
      :label="$t('access.label')"
      :placeholder="$t('access.labelHint')"
      :rules="[required]"
      autofocus
    />
    <v-select
      v-model="draft.role"
      :items="roleItems"
      :label="$t('access.role')"
      :item-props="true"
    />
    <v-select
      v-if="draft.role === AccessRole.STAGE_MARSHAL"
      v-model="draft.stageIds"
      :items="stageItems"
      :label="$t('access.stages')"
      :rules="[stagesRequired]"
      multiple
      chips
    />
  </FormDialog>

  <FormDialog
    v-model="passwordOpen"
    :title="
      session?.passwordSet
        ? $t('access.changePassword')
        : $t('access.setPassword')
    "
    :form="passwordDraft"
    :save="() => setPassword(passwordDraft.password)"
    :saved="$t('access.passwordSaved')"
  >
    <v-text-field
      v-model="passwordDraft.password"
      type="password"
      :label="$t('access.newPassword')"
      :rules="[minLength]"
      autocomplete="new-password"
      autofocus
    />
  </FormDialog>
</template>
