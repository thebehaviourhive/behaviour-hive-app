import type { SupabaseClient } from "@supabase/supabase-js";

const DIGITS = "0123456789";

function lettersFromName(childName: string): string {
  const cleaned = childName.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return cleaned.slice(0, 3).padEnd(3, "X");
}

function randomDigits(length: number): string {
  let digits = "";
  for (let i = 0; i < length; i++) {
    digits += DIGITS[Math.floor(Math.random() * DIGITS.length)];
  }
  return digits;
}

// Generates a memorable "XXX-NNNN" passport code (e.g. SAM-4821) from the
// child's first name, retrying on the vanishingly rare chance of a
// collision with an existing code.
export async function generateUniquePassportCode(
  supabase: SupabaseClient,
  childName: string
): Promise<string> {
  const prefix = lettersFromName(childName || "CHD");

  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${prefix}-${randomDigits(4)}`;
    const { data } = await supabase
      .from("passports")
      .select("id")
      .eq("passport_code", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }

  throw new Error("Could not generate a unique passport code. Please try again.");
}
