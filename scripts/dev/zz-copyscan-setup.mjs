import fs from "fs";
const raw = fs.readFileSync(".env.local", "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  let val = m[2];
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[m[1]] = val;
}
const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = "CopyScan2026!";

async function createInstitution(name, code, type) {
  const { data, error } = await admin
    .from("institutions")
    .insert({ name, institution_code: code, type, status: "verified" })
    .select("id, institution_code")
    .single();
  if (error) throw new Error(`institution ${code}: ${error.message}`);
  return data;
}

async function createUser(emailPrefix, fullName) {
  const email = `${emailPrefix}@thebehaviourhive.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`user ${email}: ${error.message}`);
  return { id: data.user.id, email };
}

async function setRole(userId, role) {
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { role } });
  if (error) throw new Error(`set role ${role} on ${userId}: ${error.message}`);
}

async function sessionFor(email) {
  const anon = createClient(anonUrl, anonKey);
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return createClient(anonUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

const clinic = await createInstitution("ZZ0280 Riverside Clinic", "ZZ0280CLINIC", "clinic");

// Director -- bootstrap principal, joins first (auto-approves), then
// picks a specialty to become a genuine practising director.
const director = await createUser("zz0280director", "Dr. Fiona Ahern");
await setRole(director.id, "principal");
const directorClient = await sessionFor(director.email);
{
  const { error } = await directorClient
    .from("institution_staff")
    .insert({ user_id: director.id, institution_id: clinic.id, role: "principal" });
  if (error) throw new Error(`director self-link: ${error.message}`);
}

// Practitioner -- joins by code, approved by the director.
const practitioner = await createUser("zz0280practitioner", "Marcus O'Sullivan");
await setRole(practitioner.id, "clinician");
{
  const { error } = await admin.from("institution_staff").insert({
    user_id: practitioner.id,
    institution_id: clinic.id,
    role: "clinician",
    approved_at: new Date().toISOString(),
    approval_source: "principal",
  });
  if (error) throw new Error(`practitioner: ${error.message}`);
}
{
  const { error } = await admin.from("clinicians").insert({
    user_id: practitioner.id,
    specialty: "ot",
    verification_status: "verified",
    verification_route: "organisation",
    domain_tags: [],
  });
  if (error) throw new Error(`practitioner clinicians row: ${error.message}`);
}

// Clinical lead
const lead = await createUser("zz0280lead", "Dr. Grainne Doyle");
await setRole(lead.id, "clinical_lead");
{
  const { error } = await admin.from("institution_staff").insert({
    user_id: lead.id,
    institution_id: clinic.id,
    role: "clinical_lead",
    approved_at: new Date().toISOString(),
    approval_source: "principal",
  });
  if (error) throw new Error(`lead: ${error.message}`);
}

// Clinic admin
const clinicAdmin = await createUser("zz0280admin", "Aisling Nolan");
await setRole(clinicAdmin.id, "clinic_admin");
{
  const { error } = await admin.from("institution_staff").insert({
    user_id: clinicAdmin.id,
    institution_id: clinic.id,
    role: "clinic_admin",
    approved_at: new Date().toISOString(),
    approval_source: "principal",
  });
  if (error) throw new Error(`admin: ${error.message}`);
}

// A clinic-only client -- no school link at all, so any school word
// appearing for the parent is unambiguously wrong.
const { data: passportId, error: onboardError } = await directorClient.rpc("onboard_clinic_client", {
  p_institution_id: clinic.id,
  p_client_name: "Eabha Lynch",
});
if (onboardError) throw new Error(`onboard: ${onboardError.message}`);

const parent = await createUser("zz0280parent", "Tomas Lynch");
await setRole(parent.id, "parent");
{
  const { error } = await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parent.id });
  if (error) throw new Error(`guardian link: ${error.message}`);
}

// Engage the practitioner on this client, so the director has real
// caseload work to inspect too.
{
  const { error } = await directorClient.rpc("grant_clinician_access", {
    p_passport_id: passportId,
    p_clinician_id: practitioner.id,
  });
  if (error) console.log("grant_clinician_access (director->practitioner):", error.message);
}

console.log(
  JSON.stringify(
    {
      password: PASSWORD,
      clinic,
      director,
      practitioner,
      lead,
      clinicAdmin,
      parent,
      passportId,
    },
    null,
    2
  )
);
