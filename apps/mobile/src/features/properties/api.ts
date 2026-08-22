import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePropertyInput,
  CreateUnitInput,
  Page,
  UnitAvailability,
  UnitOccupancyState,
  UnitType,
  UpdatePropertyInput,
  UpdateUnitInput,
} from '@rms/shared';
import { api } from '../../api/client';
import { dashboardKey } from '../dashboard/api';

/**
 * Properties and units.
 *
 * Query keys are hierarchical so a mutation invalidates exactly the subtree it
 * affected — adding a unit refreshes that property, not every list in the app.
 */

export const propertyKeys = {
  all: ['properties'] as const,
  list: () => [...propertyKeys.all, 'list'] as const,
  detail: (id: string) => [...propertyKeys.all, id] as const,
  units: (id: string) => [...propertyKeys.all, id, 'units'] as const,
};

export interface PropertyResponse {
  id: string;
  name: string;
  province: string | null;
  district: string | null;
  municipality: string | null;
  ward: number | null;
  addressLine: string | null;
  landmark: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface UnitResponse {
  id: string;
  propertyId: string;
  parentUnitId: string | null;
  label: string;
  type: UnitType;
  floor: string | null;
  availability: UnitAvailability;
  /** Derived on the server: OCCUPIED when an active rental exists (§22). */
  occupancy: UnitOccupancyState;
  archivedAt: string | null;
  createdAt: string;
}

export function useProperties() {
  return useQuery({
    queryKey: propertyKeys.list(),
    queryFn: () => api.get<Page<PropertyResponse>>('/api/v1/properties?limit=50'),
  });
}

export function useProperty(id: string) {
  return useQuery({
    queryKey: propertyKeys.detail(id),
    queryFn: () => api.get<PropertyResponse>(`/api/v1/properties/${id}`),
    enabled: Boolean(id),
  });
}

export function useUnits(propertyId: string) {
  return useQuery({
    queryKey: propertyKeys.units(propertyId),
    queryFn: () => api.get<Page<UnitResponse>>(`/api/v1/properties/${propertyId}/units?limit=100`),
    enabled: Boolean(propertyId),
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePropertyInput) =>
      api.post<PropertyResponse>('/api/v1/properties', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: propertyKeys.list() });
      // The dashboard counts properties, so it is stale too.
      void queryClient.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useCreateUnit(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUnitInput) =>
      api.post<UnitResponse>(`/api/v1/properties/${propertyId}/units`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: propertyKeys.units(propertyId) });
      void queryClient.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useUpdateProperty(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePropertyInput) =>
      api.patch<PropertyResponse>(`/api/v1/properties/${propertyId}`, input),
    onSuccess: (property) => {
      queryClient.setQueryData(propertyKeys.detail(propertyId), property);
      void queryClient.invalidateQueries({ queryKey: propertyKeys.list() });
    },
  });
}

/**
 * Archives a property. NOT a delete.
 *
 * The backend refuses while active rentals exist and only sets `archivedAt`,
 * because financial history must survive (§34, §57). The UI must not present
 * this as deletion — a landlord who believes their records were destroyed will
 * behave differently from one who knows they were filed away.
 */
export function useArchiveProperty(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Returns the archived record, carrying `archivedAt` — not a bare 204.
    mutationFn: () => api.delete<PropertyResponse>(`/api/v1/properties/${propertyId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: propertyKeys.all });
      void queryClient.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useUpdateUnit(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ unitId, input }: { unitId: string; input: UpdateUnitInput }) =>
      api.patch<UnitResponse>(`/api/v1/properties/${propertyId}/units/${unitId}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: propertyKeys.units(propertyId) });
      void queryClient.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

/** Archives a unit. Refused by the server while a tenant is in place. */
export function useArchiveUnit(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (unitId: string) =>
      api.delete<UnitResponse>(`/api/v1/properties/${propertyId}/units/${unitId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: propertyKeys.units(propertyId) });
      void queryClient.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}
