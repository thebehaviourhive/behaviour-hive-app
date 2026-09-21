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

const PASSWORD = "Stage6Lifecycle2026!";

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

const clinic = await createInstitution("ZZ0276 Bright Path Clinic", "ZZ0276CLINIC", "clinic");
const school = await createInstitution("ZZ0276 Oakwood National School", "ZZ0276SCHOOL", "school");

const director = await createUser("zz0276director", "Dr. Aoife Byrne");
await setRole(director.id, "principal");
const directorClient = await sessionFor(director.email);
{
  const { error } = await directorClient
    .from("institution_staff")
    .insert({ user_id: director.id, institution_id: clinic.id, role: "principal" });
  if (error) throw new Error(`director self-link: ${error.message}`);
}

const teacher = await createUser("zz0276teacher", "Niamh Kelly");
await setRole(teacher.id, "class_teacher");
{
  // First staff at a fresh school auto-approves as principal only --
  // insert the teacher directly with approved_at set (service role),
  // matching this schema's own established fixture pattern for a
  // second/third staff member who isn't the founding principal.
  const { error } = await admin.from("institution_staff").insert({
    user_id: teacher.id,
    institution_id: school.id,
    role: "class_teacher",
    approved_at: new Date().toISOString(),
    approval_source: "principal",
  });
  if (error) throw new Error(`teacher self-link: ${error.message}`);
}

async function makeChild(label, parentPrefix, parentName, childName) {
  const { data: passportId, error: onboardError } = await directorClient.rpc("onboard_clinic_client", {
    p_institution_id: clinic.id,
    p_client_name: childName,
  });
  if (onboardError) throw new Error(`onboard ${label}: ${onboardError.message}`);

  const parent = await createUser(parentPrefix, parentName);
  await setRole(parent.id, "parent");
  {
    const { error } = await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parent.id });
    if (error) throw new Error(`guardian link ${label}: ${error.message}`);
  }
  {
    const { error } = await admin.from("passport_institution_links").insert({
      passport_id: passportId,
      institution_id: school.id,
      approved_by_parent: true,
    });
    if (error) throw new Error(`link to school ${label}: ${error.message}`);
  }

  // FBA completed and BSP signed WELL BEFORE any grant exists -- the
  // 6.4 correction is specifically that a grant shares what already
  // exists, not only future work. Backdated 30 days to make the point
  // unambiguous, not just technically true.
  const backdated = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: fbaInsert, error: fbaInsertError } = await admin
    .from("fba_reports")
    .insert({
      passport_id: passportId,
      clinician_id: director.id,
      status: "completed",
      content_data: {},
      created_at: backdated,
    })
    .select("id")
    .single();
  if (fbaInsertError) throw new Error(`insert FBA ${label}: ${fbaInsertError.message}`);

  const { data: bspInsert, error: bspInsertError } = await admin
    .from("bsp")
    .insert({
      passport_id: passportId,
      institution_id: clinic.id,
      clinician_id: director.id,
      status: "active",
      signed_at: backdated,
      created_at: backdated,
    })
    .select("id")
    .single();
  if (bspInsertError) throw new Error(`insert BSP ${label}: ${bspInsertError.message}`);

  return { passportId, parent, fbaId: fbaInsert.id, bspId: bspInsert.id };
}

const childA = await makeChild("A", "zz0276parenta", "Sinead Doyle", "Rian Doyle");
const childB = await makeChild("B", "zz0276parentb", "Orla Byrne", "Cian Byrne");
const childC = await makeChild("C", "zz0276parentc", "Mairead Walsh", "Saoirse Walsh");

console.log(
  JSON.stringify(
    {
      password: PASSWORD,
      clinic,
      school,
      director,
      teacher,
      childA,
      childB,
      childC,
    },
    null,
    2
  )
);
