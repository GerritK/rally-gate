import {
  mayDo,
  type AccessRole,
  type AuthDevice,
  type AuthSession,
  type Invitation,
  type Permission,
} from '@rally-gate/shared';
import { t } from '@rally-gate/ui';
import { ref } from 'vue';
import { apiFetch, patchJson, postJson, postRequest, putJson } from './client';

/** Who this browser is; loaded by `App.vue`, kept by the calls below. */
export const session = ref<AuthSession | null>(null);

/**
 * Whether to show a control at all. A role that may never do it doesn't see
 * it; a passing reason (rally status, an active stage) is the page's own
 * concern. Reactive: reads `session`.
 */
export const can = (permission: Permission, stageId?: string | null) =>
  mayDo(session.value ?? { role: null, stageIds: [] }, permission, stageId);

export async function fetchSession(): Promise<void> {
  session.value = await apiFetch('/auth/session');
}

export async function redeem(code: string): Promise<void> {
  session.value = await postJson('/auth/redeem', { code });
}

export async function login(password: string): Promise<void> {
  session.value = await postJson('/auth/login', { password });
}

export async function logout(): Promise<void> {
  await postRequest('/auth/logout');
  await fetchSession();
}

/** The first password, from the setup link the server logs. */
export function setupPassword(token: string, password: string): Promise<void> {
  return postJson('/auth/setup', { token, password });
}

export async function setPassword(password: string): Promise<void> {
  await putJson('/auth/password', { password });
  await fetchSession();
}

/** The server's LAN addresses, `http://ip:port`, for the QR codes. */
export function fetchServerUrls(): Promise<string[]> {
  return apiFetch('/auth/server-urls');
}

export function fetchInvitations(): Promise<Invitation[]> {
  return apiFetch('/auth/invitations');
}

export function createInvitation(input: {
  label: string;
  role: AccessRole;
  stageIds: string[];
}): Promise<Invitation> {
  return postJson('/auth/invitations', input);
}

export function setInvitationBlocked(
  id: string,
  blocked: boolean,
): Promise<Invitation> {
  return patchJson(`/auth/invitations/${id}`, { blocked });
}

export function fetchDevices(): Promise<AuthDevice[]> {
  return apiFetch('/auth/devices');
}

export function setDeviceBlocked(id: string, blocked: boolean): Promise<void> {
  return patchJson(`/auth/devices/${id}`, { blocked });
}

/** Grouped for reading off paper; the server ignores the dash. */
export const formatCode = (code: string) =>
  `${code.slice(0, 4)}-${code.slice(4)}`;

export const joinUrl = (base: string, code: string) => `${base}/join/${code}`;

/** "Anna – Start SS2 · Device 2", how the correction history will name it. */
export function sessionName(s: AuthSession | null): string {
  if (!s?.role) return '';
  if (s.deviceNumber === null) return t('login.thisComputer');
  const who = s.label ?? t(`access.roles.${s.role}`);
  return `${who} · ${t('access.device', { n: s.deviceNumber })}`;
}
