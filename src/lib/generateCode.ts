// 6-character alphanumeric codes for institutions/access — deliberately
// excludes visually ambiguous characters (0/O, 1/I/L) since these are
// meant to be read aloud or copied by hand between a school and parents.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}
