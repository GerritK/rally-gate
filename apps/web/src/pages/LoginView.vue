<script setup lang="ts">
import { notify, t } from '@rally-gate/ui';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  login,
  logout,
  redeem,
  session,
  sessionName,
  setupPassword,
} from '../api/auth';

/** `/join/:code` is what an invitation's QR code opens. */
const props = defineProps<{ code?: string }>();
const route = useRoute();
const router = useRouter();

/** From the setup link the server logs while no password is set. */
const setupToken = computed(() =>
  typeof route.query.setup === 'string' ? route.query.setup : null,
);

const code = ref(props.code ?? '');
const password = ref('');
const busy = ref<'code' | 'password' | null>(null);
const error = ref<{ form: 'code' | 'password'; text: string } | null>(null);

const minLength = (v: string) => v.length >= 8 || t('access.passwordMin');

async function run(form: 'code' | 'password', action: () => Promise<void>) {
  busy.value = form;
  error.value = null;
  try {
    await action();
    notify(t('login.loggedIn', { who: sessionName(session.value) }));
    await router.replace('/live');
  } catch (err) {
    error.value = { form, text: (err as Error).message };
  } finally {
    busy.value = null;
  }
}

const onCode = () =>
  run('code', async () => {
    await redeem(code.value);
  });

const onPassword = () =>
  run('password', async () => {
    if (setupToken.value) {
      await setupPassword(setupToken.value, password.value);
    }
    await login(password.value);
  });

async function onLogout() {
  await logout();
  notify(t('login.loggedOut'));
  if (!session.value?.role) await router.replace('/public');
}

onMounted(() => {
  if (props.code) return onCode();
});
</script>

<template>
  <v-row justify="center">
    <v-col cols="12" sm="8" md="6" lg="4">
      <v-card v-if="session" class="mb-4">
        <v-card-text class="d-flex align-center ga-3">
          <v-icon
            :icon="session.role ? 'mdi-account-check' : 'mdi-account-off'"
            :color="session.role ? 'success' : undefined"
          />
          <div class="flex-grow-1">
            <template v-if="session.role">
              <div class="text-caption text-medium-emphasis">
                {{ $t('login.current') }}
              </div>
              <div class="text-body-1 font-weight-medium">
                {{ sessionName(session) }}
              </div>
            </template>
            <template v-else>{{ $t('login.notLoggedIn') }}</template>
          </div>
          <!-- The server machine is the organiser by its address: nothing
               to log out of. -->
          <v-btn
            v-if="session.deviceId"
            variant="text"
            prepend-icon="mdi-logout"
            @click="onLogout"
          >
            {{ $t('login.logOut') }}
          </v-btn>
        </v-card-text>
      </v-card>

      <!-- Logged in, only who and Log out: a new invitation's QR code still
           works through /join, and its error lands here. -->
      <v-card
        v-if="!setupToken && (!session?.role || error?.form === 'code')"
        class="mb-4"
      >
        <v-card-title>{{ $t('login.codeTitle') }}</v-card-title>
        <v-card-text>
          <v-form @submit.prevent="onCode">
            <v-alert
              v-if="error?.form === 'code'"
              type="error"
              variant="tonal"
              class="mb-4"
              :text="error.text"
            />
            <v-text-field
              v-model="code"
              :label="$t('login.code')"
              :hint="$t('login.codeHint')"
              autocapitalize="characters"
              autocomplete="off"
              persistent-hint
            />
            <v-btn
              type="submit"
              color="primary"
              class="mt-4"
              block
              :loading="busy === 'code'"
              :disabled="!code.trim()"
            >
              {{ $t('login.logIn') }}
            </v-btn>
          </v-form>
        </v-card-text>
      </v-card>

      <v-card v-if="setupToken || !session?.role">
        <v-card-title>
          {{ setupToken ? $t('login.setupTitle') : $t('login.passwordTitle') }}
        </v-card-title>
        <v-card-text>
          <p v-if="setupToken" class="mb-4">{{ $t('login.setupExplain') }}</p>
          <p class="mb-4 text-medium-emphasis">{{ $t('login.wifiRule') }}</p>
          <v-form @submit.prevent="onPassword">
            <v-alert
              v-if="error?.form === 'password'"
              type="error"
              variant="tonal"
              class="mb-4"
              :text="error.text"
            />
            <v-text-field
              v-model="password"
              type="password"
              :label="
                setupToken ? $t('access.newPassword') : $t('login.password')
              "
              :rules="setupToken ? [minLength] : []"
              :autocomplete="setupToken ? 'new-password' : 'current-password'"
            />
            <v-btn
              type="submit"
              :color="setupToken ? 'primary' : undefined"
              :variant="setupToken ? 'flat' : 'tonal'"
              class="mt-4"
              block
              :loading="busy === 'password'"
              :disabled="setupToken ? password.length < 8 : !password"
            >
              {{ setupToken ? $t('access.setPassword') : $t('login.logIn') }}
            </v-btn>
          </v-form>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>
