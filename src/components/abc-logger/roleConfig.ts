// Role-aware copy and options for the ABC Incident Logger, kept as one
// dictionary rather than scattered if/else blocks so a new role is a new
// entry here, not a hunt through ABCLogger.tsx and ABCTimeline.tsx.
//
// Everything that reads from these (ABCLogger's step content, ABCTimeline's
// footer/reporter-filter labels) picks up a new entry automatically.
export type ABCLoggerRole = "parent" | "class_teacher" | "clinician";

export interface ABCChipStepConfig {
  label: string;
  helper: string;
  options: string[];
}

export type ABCStep4Extra =
  | { type: "notes"; label: string }
  | { type: "perceivedFunction"; label: string };

export interface ABCRoleConfig {
  intensityLabel: string;
  antecedent: ABCChipStepConfig;
  behaviour: ABCChipStepConfig;
  consequence: ABCChipStepConfig;
  step4Extra: ABCStep4Extra;
}

export const PERCEIVED_FUNCTION_OPTIONS: { value: string; label: string }[] = [
  { value: "escape", label: "Escape or avoidance" },
  { value: "attention", label: "Seeking attention" },
  { value: "tangible", label: "Access to tangible" },
  { value: "sensory", label: "Sensory regulation" },
];

export const ABC_ROLE_CONFIG: Record<ABCLoggerRole, ABCRoleConfig> = {
  parent: {
    intensityLabel: "How intense was it?",
    antecedent: {
      label: "What happened right before?",
      helper: "Think about what was going on right before the behaviour started.",
      options: [
        "Asked them to do something",
        "Change of plan",
        "Told them no",
        "Too loud or busy",
        "Other",
      ],
    },
    behaviour: {
      label: "What did they do?",
      helper: "Describe exactly what you saw, like a video recording.",
      options: [
        "Hit, kicked, or bit",
        "Ran away or hid",
        "Cried or screamed",
        "Threw or broke things",
        "Other",
      ],
    },
    consequence: {
      label: "What happened next?",
      helper: "How did you or others react? Did they get what they wanted?",
      options: [
        "Stopped asking them to do the task",
        "Comforted them",
        "Ignored it",
        "Gave them the item they wanted",
        "Other",
      ],
    },
    step4Extra: { type: "notes", label: "Anything else you want to add?" },
  },
  class_teacher: {
    intensityLabel: "Intensity Level",
    antecedent: {
      label: "Antecedent (Trigger)",
      helper: "What was the immediate context or setting event in the classroom?",
      options: [
        "Task demand placed",
        "Transition to new activity",
        "Denied access to item or activity",
        "Sensory overload",
        "Other",
      ],
    },
    behaviour: {
      label: "Observable Behaviour",
      helper: "Select the objective, measurable actions observed.",
      options: [
        "Physical aggression",
        "Elopement (leaving area)",
        "Vocal outburst",
        "Property destruction",
        "Other",
      ],
    },
    consequence: {
      label: "Consequence (Outcome)",
      helper: "What was the immediate response or environmental change?",
      options: [
        "Task removed or delayed",
        "1:1 attention given",
        "Planned ignoring",
        "Access to tangible provided",
        "Other",
      ],
    },
    step4Extra: {
      type: "perceivedFunction",
      label: "Why do you think this happened? (optional)",
    },
  },
  clinician: {
    intensityLabel: "Intensity Level",
    antecedent: {
      label: "Antecedent (Setting Event / Trigger)",
      helper: "What was the environmental or contextual trigger immediately preceding the behaviour?",
      options: [
        "Task demand placed",
        "Transition to new activity",
        "Denied access to item or activity",
        "Sensory overload",
        "Social conflict",
        "Other",
      ],
    },
    behaviour: {
      label: "Observable Behaviour",
      helper: "Describe the objective, measurable behaviour observed.",
      options: [
        "Physical aggression",
        "Elopement (leaving area)",
        "Vocal outburst",
        "Property destruction",
        "Self-injurious behaviour",
        "Other",
      ],
    },
    consequence: {
      label: "Consequence (Maintaining Outcome)",
      helper: "What immediate response or environmental change followed?",
      options: [
        "Task removed or delayed",
        "1:1 attention given",
        "Planned ignoring",
        "Access to tangible provided",
        "Other",
      ],
    },
    step4Extra: {
      type: "perceivedFunction",
      label: "Perceived function of behaviour",
    },
  },
};

export const ABC_ROLE_DISPLAY_LABEL: Record<ABCLoggerRole, string> = {
  parent: "Parent",
  class_teacher: "Teacher",
  clinician: "Clinician",
};
