import Link from "next/link";

type TeacherNavTab = "dashboard" | "students" | "more";

const TABS: { key: TeacherNavTab; icon: string; label: string; href?: string }[] = [
  { key: "dashboard", icon: "🏠", label: "Dashboard", href: "/teacher/dashboard" },
  { key: "students", icon: "🧒", label: "Students", href: "/teacher/students" },
  { key: "more", icon: "⋯", label: "More", href: "/more" },
];

export function TeacherBottomNav({ active }: { active: TeacherNavTab }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-sm items-center justify-around py-2">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          const className = `flex flex-col items-center gap-0.5 px-2 py-1 ${
            isActive ? "text-brand-prussian-blue" : "text-black/35"
          }`;
          const content = (
            <>
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              <span className={`text-[10px] ${isActive ? "font-semibold" : "font-medium"}`}>
                {tab.label}
              </span>
            </>
          );

          if (tab.href) {
            return (
              <Link key={tab.key} href={tab.href} className={className}>
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
