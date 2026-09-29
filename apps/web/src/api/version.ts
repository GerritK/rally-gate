import { ref } from 'vue';
import { apiFetch } from './client';

/** The server's build, shared so the Hardware page can compare gates to it. */
export const serverVersion = ref('');

export async function fetchServerVersion(): Promise<void> {
  serverVersion.value = (
    await apiFetch<{ version: string }>('/version')
  ).version;
}
