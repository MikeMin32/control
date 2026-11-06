/** Canonical default checklist definitions (snapshot sources). */

export const SETUP_SECTIONS = ["VM", "Domain", "PurelyMail"] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export type DefaultTemplateItem = {
  label: string;
  required: boolean;
  section?: SetupSection;
  description?: string;
};

/** Wipeout: email shutdown is distinct from profile removal; RedDot is separate. */
export const DEFAULT_WIPEOUT_ITEMS: DefaultTemplateItem[] = [
  {
    label: "Proxy subscription cancelled or renewal disabled.",
    required: true,
  },
  { label: "Proxy configuration removed.", required: true },
  { label: "Browser/application profiles removed.", required: true },
  {
    label: "Shut down the associated email account.",
    required: true,
    description:
      "Check whether the email is still used by another service before shutting it down.",
  },
  {
    label: "Delete the associated RedDot card.",
    required: true,
    description:
      "Record a non-sensitive label only (e.g. last four or nickname). Never store full card details.",
  },
  { label: "VM deleted or prepared for reuse.", required: true },
  { label: "Relevant network rules and access removed.", required: true },
];

/** Older wipeout email wording — treat as similar so we do not silently duplicate. */
export const LEGACY_WIPEOUT_EMAIL_LABEL =
  "Associated email accounts removed or detached as appropriate.";

export const DEFAULT_SETUP_ITEMS: DefaultTemplateItem[] = [
  { section: "VM", label: "Create the VM", required: true },
  { section: "VM", label: "Purchase a proxy", required: true },
  { section: "VM", label: "Run the provisioning script", required: true },
  { section: "VM", label: "Synchronize time", required: true },
  { section: "VM", label: "Install browsers", required: true },
  { section: "VM", label: "Install fonts", required: true },
  { section: "VM", label: "Register an AtomicMail account", required: true },
  { section: "Domain", label: "Register a Dynadot account", required: true },
  { section: "Domain", label: "Create a payment card", required: true },
  { section: "Domain", label: "Purchase a domain", required: true },
  {
    section: "PurelyMail",
    label: "Register and pay for PurelyMail",
    required: true,
  },
  { section: "PurelyMail", label: "Connect the domain", required: true },
  { section: "PurelyMail", label: "Create a mail user", required: true },
  { section: "PurelyMail", label: "Test sending email", required: true },
];

export function normalizeChecklistLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[.\s]+$/g, "").replace(/\s+/g, " ");
}

export function isSimilarEmailWipeoutTask(label: string): boolean {
  const n = normalizeChecklistLabel(label);
  if (n.includes("email") && (n.includes("shut") || n.includes("remov") || n.includes("detach"))) {
    return true;
  }
  return normalizeChecklistLabel(LEGACY_WIPEOUT_EMAIL_LABEL) === n;
}

export function isRedDotWipeoutTask(label: string): boolean {
  const n = normalizeChecklistLabel(label);
  return n.includes("reddot") || n.includes("red dot");
}
