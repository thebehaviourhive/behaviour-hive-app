// Shared display copy for passport Section A fields that render in more
// than one place. Single-point-of-truth so a future copy edit can't
// drift the two surfaces apart the way "Important people in my life"
// (the wizard's field label) and "Important People" (the dashboard's
// read-view sub-heading) had already silently drifted from each other.
//
// Title only -- the underlying field (storage key `important_people`,
// its placeholder, and its helper text) is untouched by this constant.
export const IMPORTANT_PEOPLE_TITLE = "My child's circle of support";
