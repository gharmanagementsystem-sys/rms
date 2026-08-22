import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChargeProrationPolicy,
  ChargeType,
  CreateRentalInput,
  EndRentalInput,
  MeterReadingInput,
  MidPeriodEndPolicy,
  Page,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  PricingModel,
  RecordPaymentInput,
  RentalStatus,
  RentFrequency,
  ReplaceChargesInput,
  SettlementStatus,
  UnitType,
  UpdateRentalInput,
} from '@rms/shared';
import { api } from '../../api/client';
import { dashboardKey } from '../dashboard/api';
import { propertyKeys } from '../properties/api';

export const rentalKeys = {
  all: ['rentals'] as const,
  list: () => [...rentalKeys.all, 'list'] as const,
  detail: (id: string) => [...rentalKeys.all, id] as const,
  periods: (id: string) => [...rentalKeys.all, id, 'periods'] as const,
  payments: (id: string) => [...rentalKeys.all, id, 'payments'] as const,
  summary: (id: string) => [...rentalKeys.all, id, 'summary'] as const,
};

export interface ChargeResponse {
  id: string;
  chargeType: ChargeType;
  label: string | null;
  pricingModel: PricingModel;
  amountPaisa: number | null;
  ratePaisaPerUnit: number | null;
  prorationPolicy: ChargeProrationPolicy | null;
}

export interface RentalResponse {
  id: string;
  status: RentalStatus;
  ownerUserId: string | null;
  renterUserId: string | null;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
  unit: { id: string; label: string; type: UnitType; propertyId: string } | null;
  placeLabel: string | null;
  placeAddress: string | null;
  frequency: RentFrequency;
  /** 30 or 365 — fixed duration, snapshotted at creation (ADR 0001). */
  periodDays: number;
  startDate: string;
  endDate: string | null;
  dueOffsetDays: number;
  overdueAfterDays: number;
  midPeriodEndPolicy: MidPeriodEndPolicy;
  securityDepositPaisa: number | null;
  charges: ChargeResponse[];
  notes: string | null;
  endedReason: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface PeriodChargeResponse extends ChargeResponse {
  previousReading: number | null;
  currentReading: number | null;
  consumedUnits: number | null;
  isFinalized: boolean;
}

export interface PeriodResponse {
  id: string;
  sequenceNumber: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  coveredDays: number;
  basisDays: number;
  isProrated: boolean;
  totalPaisa: number;
  paidPaisa: number;
  balancePaisa: number;
  settlementStatus: SettlementStatus;
  /** Derived at read time, never stored (§15). */
  isOverdue: boolean;
  chargesComplete: boolean;
  charges: PeriodChargeResponse[];
}

export interface PaymentResponse {
  id: string;
  purpose: PaymentPurpose;
  amountPaisa: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  status: PaymentStatus;
  recordedByUserId: string;
  allocations: { periodId: string; amountPaisa: number }[];
  unallocatedPaisa: number;
  createdAt: string;
}

export function useRentals(params: { status?: RentalStatus } = {}) {
  const query = params.status ? `&status=${params.status}` : '';
  return useQuery({
    queryKey: [...rentalKeys.list(), params],
    queryFn: () => api.get<Page<RentalResponse>>(`/api/v1/rentals?limit=50${query}`),
  });
}

export function useRental(id: string) {
  return useQuery({
    queryKey: rentalKeys.detail(id),
    queryFn: () => api.get<RentalResponse>(`/api/v1/rentals/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * Periods for a rental.
 *
 * The server generates any missing period as a side effect of this read, so a
 * missed scheduler run heals the moment someone opens the screen (§16).
 */
export function usePeriods(rentalId: string) {
  return useQuery({
    queryKey: rentalKeys.periods(rentalId),
    queryFn: () => api.get<Page<PeriodResponse>>(`/api/v1/rentals/${rentalId}/periods`),
    enabled: Boolean(rentalId),
  });
}

export function usePayments(rentalId: string) {
  return useQuery({
    queryKey: rentalKeys.payments(rentalId),
    queryFn: () => api.get<Page<PaymentResponse>>(`/api/v1/rentals/${rentalId}/payments`),
    enabled: Boolean(rentalId),
  });
}

export interface RentalSummaryResponse {
  rentalId: string;
  status: RentalStatus;
  billedPaisa: number;
  paidPaisa: number;
  outstandingPaisa: number;
  /** Money received but not yet applied to a period — an overpayment. */
  creditPaisa: number;
  /** Refundable. Never offsets rent (§45). */
  depositHeldPaisa: number;
  periodCount: number;
  overdueCount: number;
  overduePaisa: number;
  nextDueDate: string | null;
  nextDuePaisa: number;
}

/**
 * The rental's overall position, computed by the server.
 *
 * Summing period balances on the client would miss credit and deposit
 * entirely, and an overpaid tenant would see their surplus vanish. The server
 * is the source of truth for every figure here (§54).
 */
export function useRentalSummary(rentalId: string) {
  return useQuery({
    queryKey: rentalKeys.summary(rentalId),
    queryFn: () => api.get<RentalSummaryResponse>(`/api/v1/rentals/${rentalId}/summary`),
    enabled: Boolean(rentalId),
  });
}

// --- Mutations -------------------------------------------------------------

/**
 * What a write to a rental can invalidate.
 *
 * Occupancy is DERIVED from active rentals (§22), so starting or ending a
 * rental silently changes what the properties screen shows. Forgetting the
 * property keys here would leave a unit reading AVAILABLE while a tenant lives
 * in it — the two screens would disagree, which is exactly what deriving
 * occupancy was meant to prevent.
 */
function invalidateRental(queryClient: ReturnType<typeof useQueryClient>, rentalId?: string): void {
  void queryClient.invalidateQueries({ queryKey: rentalKeys.all });
  void queryClient.invalidateQueries({ queryKey: propertyKeys.all });
  void queryClient.invalidateQueries({ queryKey: dashboardKey });
  if (rentalId) void queryClient.invalidateQueries({ queryKey: rentalKeys.detail(rentalId) });
}

export function useCreateRental() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRentalInput) => api.post<RentalResponse>('/api/v1/rentals', input),
    onSuccess: (rental) => invalidateRental(queryClient, rental.id),
  });
}

/** DRAFT → ACTIVE. Separate from creation so the occupancy check has a moment. */
export function useActivateRental() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rentalId: string) =>
      api.post<RentalResponse>(`/api/v1/rentals/${rentalId}/activate`),
    onSuccess: (rental) => invalidateRental(queryClient, rental.id),
  });
}

/**
 * Edits a rental's terms.
 *
 * `startDate` and `frequency` are deliberately absent from the schema and so
 * cannot be sent: both reshape the period schedule, and a rental with generated
 * periods cannot have its history rewritten (§3.3, §14). Changing either means
 * ending this rental and starting a new one.
 */
export function useUpdateRental(rentalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRentalInput) =>
      api.patch<RentalResponse>(`/api/v1/rentals/${rentalId}`, input),
    onSuccess: () => invalidateRental(queryClient, rentalId),
  });
}

/**
 * Replaces the whole charge set.
 *
 * Partial edits are not offered because the "exactly one rent charge" rule
 * could not then be enforced atomically. Crucially this affects FUTURE periods
 * only: each period snapshots its charges at generation and is never recomputed
 * from the current configuration, so past bills keep the prices they were
 * issued under (§3.3).
 */
export function useReplaceCharges(rentalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReplaceChargesInput) =>
      api.put<RentalResponse>(`/api/v1/rentals/${rentalId}/charges`, input),
    onSuccess: () => invalidateRental(queryClient, rentalId),
  });
}

/**
 * Deletes a rental outright. Only ever succeeds while it is still a DRAFT —
 * the server rejects anything else, since an ACTIVE or ENDED rental has real
 * accounting history to protect. `useEndRental` is the exit for those.
 */
export function useDeleteRental() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rentalId: string) => api.delete<void>(`/api/v1/rentals/${rentalId}`),
    // The deleted rental's own detail/periods/payments queries are left to go
    // stale rather than actively invalidated — the screen navigates away
    // immediately on success, so nothing is left mounted to refetch them.
    onSuccess: () => invalidateRental(queryClient),
  });
}

export function useEndRental(rentalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: EndRentalInput) =>
      api.post<RentalResponse>(`/api/v1/rentals/${rentalId}/end`, input),
    onSuccess: () => invalidateRental(queryClient, rentalId),
  });
}

export interface RecordPaymentResult {
  id: string;
  /** True when this request replayed an existing payment rather than creating
   *  one — the idempotency key had been seen before (§37). */
  replayed: boolean;
}

export function useRecordPayment(rentalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // No retry: this mutation moves money. The idempotency key makes a retry
    // safe, but an automatic one would hide a genuine failure from the user.
    retry: false,
    mutationFn: (input: RecordPaymentInput) =>
      api.post<RecordPaymentResult>(`/api/v1/rentals/${rentalId}/payments`, input),
    onSuccess: () => invalidateRental(queryClient, rentalId),
  });
}

export function useRecordMeterReading(rentalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (input: MeterReadingInput) =>
      api.post<void>(`/api/v1/rentals/${rentalId}/meter-readings`, input),
    onSuccess: () => invalidateRental(queryClient, rentalId),
  });
}
