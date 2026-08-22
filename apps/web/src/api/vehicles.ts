import { VehicleStatus } from '@rally-gate/shared';
import { apiFetch, patchJson, postJson } from './client';

export { VehicleStatus };

export interface Vehicle {
  id: string;
  startNumber: string;
  driverName: string;
  coDriverName?: string | null;
  transponderId?: string | null;
  status: VehicleStatus;
}

export function fetchVehicles(): Promise<Vehicle[]> {
  return apiFetch('/vehicles');
}

export function createVehicle(input: {
  startNumber: string;
  driverName: string;
  coDriverName?: string;
  transponderId?: string;
}): Promise<Vehicle> {
  return postJson('/vehicles', input);
}

export function updateVehicle(
  id: string,
  patch: Partial<Omit<Vehicle, 'id'>>,
): Promise<Vehicle> {
  return patchJson(`/vehicles/${id}`, patch);
}
