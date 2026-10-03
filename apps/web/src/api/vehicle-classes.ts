import { apiFetch, deleteRequest, postJson, putJson } from './client';

export interface VehicleClass {
  id: string;
  name: string;
  /** 4WD/2WD rather than a cross-cutting category like Rookie. */
  main: boolean;
}

export function fetchVehicleClasses(): Promise<VehicleClass[]> {
  return apiFetch('/vehicle-classes');
}

/** 409 if the name is taken. */
export function createVehicleClass(input: {
  name: string;
  main: boolean;
}): Promise<VehicleClass> {
  return postJson('/vehicle-classes', input);
}

export function updateVehicleClass(
  id: string,
  input: { name: string; main: boolean },
): Promise<VehicleClass> {
  return putJson(`/vehicle-classes/${id}`, input);
}

/** Takes the class off every vehicle in it; no runs are touched. */
export function deleteVehicleClass(id: string): Promise<void> {
  return deleteRequest(`/vehicle-classes/${id}`);
}
