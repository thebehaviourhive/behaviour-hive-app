export type ClinicianSpecialty =
  | "clinical_psychologist"
  | "behavioural_psychologist"
  | "educational_psychologist"
  | "gp"
  | "slt"
  | "ot";

export const CLINICIAN_SPECIALTY_LABEL: Record<ClinicianSpecialty, string> = {
  clinical_psychologist: "Clinical Psychologist",
  behavioural_psychologist: "Behavioural Psychologist",
  educational_psychologist: "Educational Psychologist",
  gp: "GP",
  slt: "Speech & Language Therapist (SLT)",
  ot: "Occupational Therapist (OT)",
};

export const CLINICIAN_SPECIALTIES: ClinicianSpecialty[] = [
  "clinical_psychologist",
  "behavioural_psychologist",
  "educational_psychologist",
  "gp",
  "slt",
  "ot",
];
