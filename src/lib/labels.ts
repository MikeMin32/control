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

/** Dot color inside status pills */
export const LIFECYCLE_DOT: Record<LifecycleStatus, string> = {
  PREPARING: "bg-[#c49a3c]",
  ACTIVE: "bg-[#2f9e5f]",
  EXPIRED: "bg-[#c45c5c]",
  BURNED: "bg-[#7a807c]",
  ARCHIVED: "bg-[#8a918c]",
};

/** Soft pill background */
export const LIFECYCLE_PILL: Record<LifecycleStatus, string> = {
  PREPARING: "bg-[#f5f0e6] text-[#6b5420]",
  ACTIVE: "bg-[#e5f5ea] text-[#1a4a2e]",
  EXPIRED: "bg-[#fce8e8] text-[#8a3030]",
  BURNED: "bg-[#eceeed] text-[#4a4f4c]",
  ARCHIVED: "bg-[#eef0ef] text-[#4a4f4c]",
};

export const AVAILABILITY_LABELS: Record<ProxyAvailability, string> = {
  AVAILABLE: "Available",
  ASSIGNED: "Assigned",
  RETIRED: "Retired",
};

export const AVAILABILITY_DOT: Record<ProxyAvailability, string> = {
  AVAILABLE: "bg-[#2f9e5f]",
  ASSIGNED: "bg-sky-500",
  RETIRED: "bg-[#7a807c]",
};

export const AVAILABILITY_PILL: Record<ProxyAvailability, string> = {
  AVAILABLE: "bg-[#e5f5ea] text-[#1a4a2e]",
  ASSIGNED: "bg-sky-50 text-sky-800",
  RETIRED: "bg-[#eceeed] text-[#4a4f4c]",
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
