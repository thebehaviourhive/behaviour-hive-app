// Shared types for the Progress feature's role-parameterized engine.
// "clinician" carries the widest read (FBA function tags, Stage B);
// "teacher" the narrowest (never anything clinical/function-tagged);
// "parent" everything about their own child. "principal" (Stage 4, item
// 1) reads institution-wide, same as get_abc_logs()'s own principal
// branch -- grouped with "teacher" everywhere this type is branched on,
// never given the clinician-only widest read or the parent-only warmth
// copy. All four render through the same ProgressSurface component --
// these are what parameterize it.
export type ProgressViewerRole = "parent" | "teacher" | "clinician" | "principal";
