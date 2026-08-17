"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { createClient } from "@/lib/supabase/client";

const CONSENT_VERSION = 1;

type ConsentRole = "parent" | "class_teacher" | "clinician";

interface ConsentCard {
  icon: string;
  iconBg: string;
  title: string;
  description?: string;
}

// Onboarding consent copy, per track (structure/logic below is fully
// shared -- only these three cards + the footer text differ by role).
// Parent's cards are byte-identical to the original single-role copy
// this screen used to carry unconditionally.
const CONSENT_CARDS: Record<ConsentRole, ConsentCard[]> = {
  parent: [
    {
      icon: "🔒",
      iconBg: "bg-brand-pastel-blue/40",
      title: "You own your child's data",
      description: "Data belongs entirely to you. Export or delete at any time.",
    },
    {
      icon: "👁",
      iconBg: "bg-brand-safe-ivory/60",
      title: "You control who sees it",
      description: "No school sees anything without your active consent.",
    },
    {
      icon: "🛡",
      iconBg: "bg-brand-prussian-blue/10",
      title: "GDPR compliant",
      description: "Registered with the Data Protection Commission.",
    },
  ],
  class_teacher: [
    {
      icon: "🔒",
      iconBg: "bg-brand-pastel-blue/40",
      title: "I will keep information shared with me confidential.",
    },
    {
      icon: "👁",
      iconBg: "bg-brand-safe-ivory/60",
      title:
        "I understand that everything I record becomes part of the child's record and is visible to their families and clinical team.",
    },
    {
      icon: "🛡",
      iconBg: "bg-brand-prussian-blue/10",
      title:
        "I understand that my personal information will be handled in accordance with The Behaviour Hive's privacy policy.",
    },
  ],
  clinician: [
    {
      icon: "🔒",
      iconBg: "bg-brand-pastel-blue/40",
      title: "I will keep information shared with me confidential.",
    },
    {
      icon: "👁",
      iconBg: "bg-brand-safe-ivory/60",
      title:
        "I understand that my personal information will be handled in accordance with The Behaviour Hive's privacy policy.",
    },
    {
      icon: "🛡",
      iconBg: "bg-brand-prussian-blue/10",
      title: "I understand the clinical content I create and publish becomes part of the child's record.",
    },
  ],
};

// The required checkbox's own wording -- parent's is the original,
// unchanged. Teacher/clinician get the brief's exact replacement text;
// each keeps the same bold "Required" suffix treatment as before (a
// visual/structural element, not part of the reworded sentence itself).
const REQUIRED_CONSENT_LABEL: Record<ConsentRole, string> = {
  parent: "I agree to Behaviour Hive storing and processing my child's data.",
  class_teacher: "I agree to The Behaviour Hive storing and processing my inputs.",
  clinician: "I agree to The Behaviour Hive storing and processing my inputs and data.",
};

// The footer link/subline -- parent's is the original standalone privacy
// link; teacher/clinician get the new subline sentence with the same
// link treatment (weight/colour) applied to just the "privacy policy"
// substring, per the brief.
function ConsentFooter({ role }: { role: ConsentRole }) {
  if (role === "parent") {
    return (
      <a href="/privacy" className="font-semibold text-brand-prussian-blue">
        Read our privacy policy
      </a>
    );
  }

  return (
    <>
      By creating an account you agree to the full terms listed in our{" "}
      <a href="/privacy" className="font-semibold text-brand-prussian-blue">
        privacy policy
      </a>
      .
    </>
  );
}

export default function ConsentPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<ConsentRole | null>(null);
  const [dataConsent, setDataConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const userRole = user.app_metadata?.role;
      if (userRole !== "parent" && userRole !== "clinician" && userRole !== "class_teacher") {
        router.replace("/");
        return;
      }

      setUserId(user.id);
      setRole(userRole);
      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleAccept() {
    if (!dataConsent || !userId || !role) return;

    setError(null);
    setIsSubmitting(true);

    // marketing_accepted stays a single boolean column (no schema change
    // -- see 0001_create_consents_table.sql) that this screen has always
    // written unconditionally; teacher/clinician just never got a UI to
    // opt in with, so their rows honestly record "false" rather than
    // carrying forward whatever marketingConsent's default happens to
    // be. This is an append-only audit table (one row per acceptance
    // event), so existing accounts' prior rows are untouched either way.
    const supabase = createClient();
    const { error: insertError } = await supabase.from("consents").insert({
      user_id: userId,
      consent_version: CONSENT_VERSION,
      marketing_accepted: role === "parent" ? marketingConsent : false,
    });

    setIsSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (role === "clinician") {
      router.push("/clinician/specialty");
      return;
    }
    if (role === "class_teacher") {
      router.push("/teacher/join-institution");
      return;
    }
    router.push("/parent-dashboard");
  }

  if (!isReady || !role) {
    return null;
  }

  const cards = CONSENT_CARDS[role];

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Your data, your rules
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3">
            {cards.map((card) => (
              <InfoCard
                key={card.title}
                icon={card.icon}
                iconBg={card.iconBg}
                title={card.title}
                description={card.description}
              />
            ))}
          </div>

          <div className="my-5 h-px bg-black/10" />

          <div className="flex flex-col gap-4">
            <Checkbox
              id="data-consent"
              checked={dataConsent}
              onChange={setDataConsent}
              required
              label={
                <>
                  {REQUIRED_CONSENT_LABEL[role]} <span className="font-semibold">Required</span>
                </>
              }
            />
            {/* Marketing opt-in: parent-only. Teacher/clinician tracks
                dropped this second checkbox entirely -- the single
                required checkbox above is the whole consent step for
                those roles now, so there's no second row to leave
                orphaned spacing where it used to sit. */}
            {role === "parent" && (
              <Checkbox
                id="marketing-consent"
                checked={marketingConsent}
                onChange={setMarketingConsent}
                label="I'd like to receive tips and updates by email."
              />
            )}
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleAccept}
            disabled={!dataConsent || isSubmitting}
            className="mt-5"
          >
            {isSubmitting ? "Saving…" : "Accept and continue"}
          </Button>

          <p className="mt-4 text-center text-xs text-black/50">
            <ConsentFooter role={role} />
          </p>
        </div>
      </div>
    </main>
  );
}

function InfoCard({
  icon,
  iconBg,
  title,
  description,
}: {
  icon: string;
  iconBg: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-black/5 bg-white p-3">
      <span
        aria-hidden
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-base ${iconBg}`}
      >
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-brand-neutral-black">
          {title}
        </p>
        {description && <p className="text-xs leading-relaxed text-black/60">{description}</p>}
      </div>
    </div>
  );
}
