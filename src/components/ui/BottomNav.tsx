import Link from "next/link";

type NavTab = "home" | "passport" | "morning" | "hive" | "more";

interface BottomNavProps {
  active: NavTab;
  passportHref?: string;
}

const TABS: { key: NavTab; icon: string; label: string }[] = [
  { key: "home", icon: "🏠", label: "Home" },
  { key: "passport", icon: "📄", label: "Passport" },
  { key: "morning", icon: "☀️", label: "Morning" },
  { key: "hive", icon: "🐝", label: "Hive" },
  { key: "more", icon: "⋯", label: "More" },
];

export function BottomNav({ active, passportHref }: BottomNavProps) {
  const hrefs: Partial<Record<NavTab, string>> = {
    home: "/parent-dashboard",
    passport: passportHref,
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-sm items-center justify-around py-2">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          const href = hrefs[tab.key];
          const className = `flex flex-col items-center gap-0.5 px-2 py-1 ${
            isActive ? "text-brand-prussian-blue" : "text-black/35"
          }`;
          const content = (
            <>
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              <span
                className={`text-[10px] ${isActive ? "font-semibold" : "font-medium"}`}
              >
                {tab.label}
              </span>
            </>
          );

          if (href) {
            return (
              <Link key={tab.key} href={href} className={className}>
                {content}
              </Link>
            );
          }

          return (
            <div key={tab.key} className={className}>
              {content}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
