import { clsx } from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { getSettings } from "@/data/queries";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { Icon, type IconName } from "./Icon";

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/studies", label: "Studies", icon: "studies" },
  { to: "/announcements", label: "Announcements", icon: "bell" },
  { to: "/participants", label: "Participants", icon: "users" },
  { to: "/friction", label: "Friction inbox", icon: "inbox" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export function AppShell() {
  const { session, signOut } = useAuth();
  const email = session?.user.email ?? "";
  const [channel, setChannel] = useState(DEFAULT_SETTINGS.channel_name);
  useEffect(() => {
    getSettings()
      .then((s) => s.channel_name && setChannel(s.channel_name))
      .catch(() => {});
  }, []);
  return (
    <div className="min-h-screen grid grid-cols-[232px_minmax(0,1fr)]">
      <aside className="bg-white border-r border-line flex flex-col sticky top-0 h-screen">
        <div className="px-4 py-4 border-b border-line-2">
          <div className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-sm bg-brand text-brand-ink grid place-items-center font-bold text-[13px]">
              RD
            </span>
            <div className="leading-tight">
              <div className="text-[13.5px] font-semibold text-ink">Research Desk</div>
              <div className="text-[11.5px] text-muted truncate">{channel} back office</div>
            </div>
          </div>
        </div>
        <nav className="p-2 flex-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2.5 px-3 h-9 rounded-sm text-[13px] font-medium transition-colors",
                  isActive ? "bg-brand-light text-brand-text" : "text-ink-2 hover:bg-fill",
                )
              }
            >
              <Icon name={n.icon} size={16} />
              <span className="flex-1">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-line-2">
          <div className="text-[12px] text-ink truncate" title={email}>
            {email}
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink cursor-pointer"
          >
            <Icon name="logout" size={13} /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  back,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="px-7 pt-6 pb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <NavLink to={back.to} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink mb-1.5">
            <Icon name="back" size={13} /> {back.label}
          </NavLink>
        )}
        <h1 className="text-[20px] font-semibold text-ink leading-tight truncate">{title}</h1>
        {sub && <div className="text-[13px] text-muted mt-1">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
