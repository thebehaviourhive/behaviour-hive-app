type NavTab = "home" | "passport" | "morning" | "hive" | "more";

interface BottomNavProps {
  active: NavTab;
}

const TABS: { key: NavTab; icon: string; label: string }[] = [
  { key: "home", icon: "🏠", label: "Home" },
  { key: "passport", icon: "📄", label: "Passport" },
  { key: "morning", icon: "☀️", label: "Morning" },
  { key: "hive", icon: "🐝", label: "Hive" },
  { key: "more", icon: "⋯", label: "More" },
];

export function BottomNav({ active }: BottomNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-black/5 bg-white">
      <div className="mx-auto flex max-w-sm items-center justify-around py-2">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <div
              key={tab.key}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 ${
                isActive ? "text-brand-prussian-blue" : "text-black/35"
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                {tab.icon}
              </span>
              <span
                className={`text-[10px] ${isActive ? "font-semibold" : "font-medium"}`}
              >
                {tab.label}
              </span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
