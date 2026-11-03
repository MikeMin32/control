import type {
  BillingStatus,
  ChecklistItemStatus,
  ClosureReason,
  LifecycleStatus,
  ProxyAvailability,
} from "@prisma/client";

export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = {
  PREPARING: "Preparing",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  BURNED: "Burned",
  ARCHIVED: "Archived",
};

export const LIFECYCLE_DOT: Record<LifecycleStatus, string> = {
  PREPARING: "bg-amber-400",
  ACTIVE: "bg-emerald-500",
  EXPIRED: "bg-orange-500",
  BURNED: "bg-rose-500",
  ARCHIVED: "bg-slate-400",
};

export const AVAILABILITY_LABELS: Record<ProxyAvailability, string> = {
  AVAILABLE: "Available",
  ASSIGNED: "Assigned",
  RETIRED: "Retired",
};

export const BILLING_LABELS: Record<BillingStatus, string> = {
  ACTIVE: "Active",
  CANCELLATION_PENDING: "Cancellation pending",
  CANCELLED: "Cancelled",
  UNKNOWN: "Unknown",
};

export const CLOSURE_REASON_LABELS: Record<ClosureReason, string> = {
  BURNED: "Burned",
  EXPIRED: "Expired",
  OTHER: "Other",
};

export const CHECKLIST_STATUS_LABELS: Record<ChecklistItemStatus, string> = {
  PENDING: "Pending",
  COMPLETED: "Completed",
  NOT_APPLICABLE: "Not applicable",
};
