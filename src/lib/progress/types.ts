// Shared types for the Progress feature's role-parameterized engine.
// "clinician" carries the widest read (FBA function tags, Stage B);
// "teacher" the narrowest (never anything clinical/function-tagged);
// "parent" everything about their own child. All three render through
// the same ProgressSurface component -- these are what parameterize it.
export type ProgressViewerRole = "parent" | "teacher" | "clinician";
