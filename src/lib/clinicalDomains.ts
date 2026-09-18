export type ClinicalDomain =
  | "cognition"
  | "behaviour_analysis"
  | "communication"
  | "sensory_motor"
  | "adaptive_living"
  | "statutory_education";

export const CLINICAL_DOMAIN_LABEL: Record<ClinicalDomain, string> = {
  cognition: "Cognition",
  behaviour_analysis: "Behaviour Analysis",
  communication: "Communication",
  sensory_motor: "Sensory & Motor",
  adaptive_living: "Adaptive & Daily Living",
  statutory_education: "Statutory / Education",
};

export const CLINICAL_DOMAINS: ClinicalDomain[] = [
  "cognition",
  "behaviour_analysis",
  "communication",
  "sensory_motor",
  "adaptive_living",
  "statutory_education",
];
