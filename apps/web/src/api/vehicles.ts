import { VehicleStatus } from '@rally-gate/shared';
import { apiFetch, patchJson, postJson } from './client';
import type { VehicleClass } from './vehicle-classes';

export { VehicleStatus };

export interface Vehicle {
  id: string;
  startNumber: number;
  driverName: string;
  coDriverName?: string | null;
  transponderId?: string | null;
  status: VehicleStatus;
  classes: VehicleClass[];
}

/** Classes are written by id and read back as objects. */
export type VehiclePatch = Partial<Omit<Vehicle, 'id' | 'classes'>> & {
  classIds?: string[];
};

export function fetchVehicles(): Promise<Vehicle[]> {
  return apiFetch('/vehicles');
}

export function createVehicle(input: {
  startNumber: number;
  driverName: string;
  coDriverName?: string;
  transponderId?: string;
  classIds?: string[];
}): Promise<Vehicle> {
  return postJson('/vehicles', input);
}

export function updateVehicle(
  id: string,
  patch: VehiclePatch,
): Promise<Vehicle> {
  return patchJson(`/vehicles/${id}`, patch);
}
