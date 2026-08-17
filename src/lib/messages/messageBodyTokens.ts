// Auto-generated message bodies (currently just the Strategy Update
// template) reference the child by a token rather than a literal name,
// because the same stored string is read by every recipient and their
// display rules for a child's name differ (teachers get the redacted
// "First L." form; parents/clinicians get the full name) -- the
// established pattern app-wide (src/lib/childDisplayName.ts) is to pick
// the name form at RENDER time, per viewer, never to bake one form into
// stored data. renderMessageBody substitutes the token with whatever
// name form the current viewer's own surface already resolved.
const CHILD_NAME_TOKEN = "{{childName}}";

export function renderMessageBody(body: string, childName: string): string {
  return body.split(CHILD_NAME_TOKEN).join(childName);
}

export const STRATEGY_UPDATE_BODY_TEMPLATE =
  `The strategies for ${CHILD_NAME_TOKEN} have been updated — please read and acknowledge.`;
