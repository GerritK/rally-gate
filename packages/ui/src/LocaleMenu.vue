<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { LOCALES, rememberLocale, type Locale } from './i18n';

const { locale, t } = useI18n();

function pick(value: Locale) {
  locale.value = value;
  rememberLocale(value);
}
</script>

<template>
  <v-menu>
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        icon="mdi-translate"
        v-tooltip:bottom="t('ui.language')"
        :aria-label="t('ui.language')"
      />
    </template>
    <v-list density="compact">
      <v-list-item
        v-for="(name, value) in LOCALES"
        :key="value"
        :title="name"
        :active="locale === value"
        @click="pick(value)"
      />
    </v-list>
  </v-menu>
</template>
