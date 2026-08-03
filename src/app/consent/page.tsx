"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { createClient } from "@/lib/supabase/client";

const CONSENT_VERSION = 1;

export default function ConsentPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
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
      if (userRole !== "parent" && userRole !== "clinician") {
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
    if (!dataConsent || !userId) return;

    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("consents").insert({
      user_id: userId,
      consent_version: CONSENT_VERSION,
      marketing_accepted: marketingConsent,
    });

    setIsSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    router.push(role === "clinician" ? "/clinician/specialty" : "/parent-dashboard");
  }

  if (!isReady) {
    return null;
  }

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
            <InfoCard
              icon="🔒"
              iconBg="bg-brand-pastel-blue/40"
              title="You own your child's data"
              description="Data belongs entirely to you. Export or delete at any time."
            />
            <InfoCard
              icon="👁"
              iconBg="bg-brand-safe-ivory/60"
              title="You control who sees it"
              description="No school sees anything without your active consent."
            />
            <InfoCard
              icon="🛡"
              iconBg="bg-brand-prussian-blue/10"
              title="GDPR compliant"
              description="Registered with the Data Protection Commission."
            />
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
                  I agree to Behaviour Hive storing and processing my
                  child&apos;s data.{" "}
                  <span className="font-semibold">Required</span>
                </>
              }
            />
            <Checkbox
              id="marketing-consent"
              checked={marketingConsent}
              onChange={setMarketingConsent}
              label="I'd like to receive tips and updates by email."
            />
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
            <a href="#" className="font-semibold text-brand-prussian-blue">
              Read our privacy policy
            </a>
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
  description: string;
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
        <p className="text-xs leading-relaxed text-black/60">{description}</p>
      </div>
    </div>
  );
}
