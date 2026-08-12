// Placeholder emergency contact list for the escalation screen
// (constraint 3A: "a placeholder contact-list block clearly marked for
// clinical sign-off, structured as data so the final approved list is a
// content edit"). Deliberately holds no real phone number beyond the
// two universal emergency numbers rendered separately in
// CalmEscalationScreen -- inventing a plausible-looking crisis-line/
// out-of-hours number here would be actively dangerous on a safety
// screen if it were ever wrong, so this ships with exactly one entry
// that names what's missing rather than guessing at it. Replacing this
// array with the real, clinically-approved list is the entire
// integration step -- no component code changes.
export interface EscalationContact {
  label: string;
  description: string;
  phone?: string;
}

export const PLACEHOLDER_EMERGENCY_CONTACTS: EscalationContact[] = [
  {
    label: "Additional support",
    description:
      "Pending clinical sign-off: the child's clinical team should confirm which additional contacts belong here (e.g. a crisis line, an out-of-hours service, or the child's own clinician's direct line).",
  },
];
