"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  BookIcon,
  CardIcon,
  ChartIcon,
  CloseIcon,
  GridIcon,
  LogoutIcon,
  MenuIcon,
  SettingsIcon,
  UsersIcon,
} from "@/components/icons";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { adminAuth } from "@/lib/api";
import { useI18n } from "@/lib/i18n/provider";

function SignOut() {
  const router = useRouter();
  return (
    <button
      className="text-ink-muted hover:bg-surface-sunken hover:text-ink rounded-control type-body flex min-h-11 w-full items-center gap-3 px-3 transition"
      data-ripple
      onClick={async () => {
        await adminAuth.logout().catch(() => undefined);
        router.replace("/admin/login");
      }}
      type="button"
    >
      <LogoutIcon size={18} />
      Sign out
    </button>
  );
}

type IconComponent = (props: { className?: string; size?: number }) => React.JSX.Element;

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  Icon: IconComponent;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", labelKey: "admin.nav.dashboard", Icon: GridIcon },
  { href: "/admin/courses", labelKey: "admin.nav.courses", Icon: BookIcon },
  { href: "/admin/enrollments", labelKey: "admin.nav.enrollments", Icon: UsersIcon },
  { href: "/admin/payments", labelKey: "admin.nav.payments", Icon: CardIcon },
  { href: "/admin/reports", labelKey: "admin.nav.reports", Icon: ChartIcon },
  { href: "/admin/settings", labelKey: "admin.nav.settings", Icon: SettingsIcon },
];

/**
 * `/admin` is the parent of every other section, so a prefix match would light
 * up Dashboard on all of them. It alone matches exactly; the rest also claim
 * their own sub-routes (`/admin/courses/new`).
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();

  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, labelKey, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              aria-current={active ? "page" : undefined}
              className={`type-label rounded-control ring-focus flex min-h-11 items-center gap-3 px-3 transition-colors duration-150 ease-out ${
                active
                  ? "bg-surface-sunken text-ink"
                  : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
              }`}
              data-ripple
              href={href}
              onClick={onNavigate}
            >
              <Icon className="shrink-0" size={18} />
              {t(labelKey)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function BackToKiosk({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();

  return (
    <Link
      className="type-label text-ink-muted hover:text-ink rounded-control ring-focus hover:bg-surface-sunken flex min-h-11 items-center gap-3 px-3 transition-colors duration-150 ease-out"
      data-ripple
      href="/"
      onClick={onNavigate}
    >
      <ArrowLeftIcon className="shrink-0 rtl:rotate-180" size={18} />
      {t("admin.nav.backToKiosk")}
    </Link>
  );
}

function Brand({ className }: { className?: string }) {
  const { t } = useI18n();

  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      {/* Decorative: the visible "Admin" label beside it already names the panel. */}
      <Image
        alt=""
        className="brand-logo h-7 w-auto shrink-0"
        height={186}
        priority
        src="/logo.png"
        width={433}
      />
      <span className="type-caption text-ink-subtle">{t("admin.nav.heading")}</span>
    </div>
  );
}

/**
 * A 240px rail on desktop (design.md §10.6) that becomes a top bar with a
 * disclosure menu below md — a tablet held in portrait has no width to spare,
 * and the rail is the first thing that has to give.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();

  // The login screen stands alone — sidebar navigation to pages the visitor
  // cannot open yet would be noise.
  const isLoginPage = pathname === "/admin/login";
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Arriving at a new route with the sheet still open would hide the page the
  // operator just asked for.
  useEffect(() => setIsMenuOpen(false), [pathname]);

  if (isLoginPage) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-surface border-hairline kiosk-nonselectable hidden border-e md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col">
        <Brand className="h-20 px-5" />

        <nav aria-label={t("admin.nav.sections")} className="flex-1 overflow-y-auto px-3 py-2">
          <NavLinks pathname={pathname} />
        </nav>

        <div className="border-hairline space-y-1 border-t px-3 py-3">
          <BackToKiosk />
          <SignOut />
        </div>
      </aside>

      <header className="bg-surface border-hairline kiosk-nonselectable sticky top-0 z-30 border-b md:hidden">
        <div className="flex h-16 items-center justify-between gap-4 px-5">
          <Brand />
          <button
            aria-controls="admin-mobile-nav"
            aria-expanded={isMenuOpen}
            aria-label={isMenuOpen ? t("admin.nav.closeMenu") : t("admin.nav.openMenu")}
            className="text-ink rounded-control ring-focus hover:bg-surface-sunken grid h-11 w-11 place-items-center transition-colors duration-150 ease-out"
            data-ripple
            onClick={() => setIsMenuOpen((open) => !open)}
            type="button"
          >
            {isMenuOpen ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
          </button>
        </div>

        {isMenuOpen && (
          <div className="border-hairline border-t px-3 py-3" id="admin-mobile-nav">
            <nav aria-label={t("admin.nav.sections")}>
              <NavLinks onNavigate={() => setIsMenuOpen(false)} pathname={pathname} />
            </nav>
            <div className="border-hairline mt-3 border-t pt-3">
              <BackToKiosk onNavigate={() => setIsMenuOpen(false)} />
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1440px] min-w-0 flex-1 px-5 py-6 md:px-8 md:py-8">
        {children}
      </main>
    </div>
  );
}
