// The single source of truth for "which version of the consent/
// agreement text is current." Bumped whenever any of the five roles'
// copy changes -- consents.consent_version (0001) is one shared
// integer across all five roles by design (matching the table's own
// original "if consent terms change later, a new row with a higher
// consent_version is inserted" model), so a change to ANY one role's
// copy bumps this for everyone, even roles whose own wording didn't
// move. Simpler than five independent per-role version counters, and
// correct for how this has actually been used so far: every change to
// date (this rebuild included) has touched all five screens at once.
//
// Bumped to 2 for the consent/agreement screens rebuild -- the old
// copy told parents things that were false ("You control who sees it",
// "No school sees anything without your active consent") and treated
// staff agreement as consent when no real choice existed. A row
// recorded against the old, false copy does not cover the new, true
// copy -- hasConsented() checks against this version specifically, not
// "any row exists at all", so returning users are shown the new
// screens once, the same as a first-time signup.
export const CURRENT_CONSENT_VERSION = 2;
