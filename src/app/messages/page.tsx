"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { fetchApprovedInstitutionPhone } from "@/lib/messages/institutionPhone";
import { getChildFirstName } from "@/lib/childDisplayName";
import { BottomNav } from "@/components/ui/BottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { MessageList } from "@/components/messages/MessageList";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";

// Parent's Messages home. Stage 2 upgrades: disclosure line (the
// transparency the clinician read-only visibility rule promised), a
// warmer contract-explaining empty state, and the archive toggle/list
// itself now carry loading skeletons via the shared MessageList.
export default function MessagesPage() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [passportId, setPassportId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);
  const [isLoadingPassport, setIsLoadingPassport] = useState(true);
  const [passportLoadError, setPassportLoadError] = useState<string | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data: passport, error } = await supabase
        .from("passports")
        .select("id, child_name")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;
      if (error) {
        console.error("Failed to load passport for Messages:", error);
        setPassportLoadError("Couldn't load Messages.");
        setIsLoadingPassport(false);
        return;
      }

      setPassportId(passport?.id ?? null);
      setChildName(passport?.child_name ?? null);

      if (passport?.id) {
        const phone = await fetchApprovedInstitutionPhone(supabase, passport.id);
        if (isMounted) setInstitutionPhone(phone);
      }

      setIsLoadingPassport(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const { messages, candidates, nameById, isLoading, loadError, refresh } = useMessageThread(passportId);
  const { categories } = useMessageCategories("parent");

  if (!isRoleReady || isLoadingPassport) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory pb-24">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <Link
            href="/parent-dashboard"
            aria-label="Back"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
          >
            ‹
          </Link>
          <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">Messages</h1>
        </div>
        {passportId && (
          <button
            type="button"
            onClick={() => setIsComposeOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-brand-prussian-blue py-2 pl-3 pr-3.5 text-sm font-semibold text-white"
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden />
            New
          </button>
        )}
      </header>

      <main className="flex-1 px-4 py-2">
        {passportLoadError ? (
          <InlineErrorState message={passportLoadError} onRetry={() => window.location.reload()} />
        ) : !passportId ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              Build {childName ?? "your child"}&apos;s passport first to start messaging their team.
            </p>
            <Link
              href="/passport/welcome"
              className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
            >
              Get started
            </Link>
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => refresh()} />
        ) : user ? (
          <MessageList
            messages={messages}
            currentUserId={user.id}
            nameById={nameById}
            isLoading={isLoading}
            onChanged={refresh}
            emptyOpenMessage={
              <>
                Send quick updates the school can acknowledge when they have a
                moment — no replies expected.
              </>
            }
            footer={
              // The transparency the clinician read-only visibility rule
              // promised, stated once at the list foot -- not per card.
              <p className="mt-5 px-1 text-center text-xs leading-relaxed text-brand-neutral-black/40">
                {getChildFirstName(childName)}&apos;s clinical team can see messages
                about {getChildFirstName(childName)} to help them spot patterns.
              </p>
            }
          />
        ) : null}
      </main>

      {passportId && user && (
        <ComposeMessageSheet
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
          passportId={passportId}
          childName={childName ?? "your child"}
          candidates={candidates}
          categories={categories}
          institutionPhone={institutionPhone}
          onSent={refresh}
        />
      )}

      <BottomNav />
    </div>
  );
}
