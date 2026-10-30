"use client";

import { Spinner } from "@heroui/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminAuth } from "@/lib/api";

type Phase = "checking" | "authenticated" | "anonymous";

/**
 * Gates the admin area behind a session check.
 *
 * This is convenience, not security — the real enforcement is server-side, on
 * every /api/admin route. A gate in the browser can always be bypassed; its job
 * is to send an operator to the login screen instead of showing them a page
 * full of failed requests.
 */
export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    let cancelled = false;

    adminAuth
      .session()
      .then(({ isAuthenticated }) => {
        if (cancelled) return;
        setPhase(isAuthenticated ? "authenticated" : "anonymous");
        if (!isAuthenticated && !isLoginPage) router.replace("/admin/login");
      })
      .catch(() => {
        // An unreachable API is not the same as being signed out, but the
        // login screen is the only place that can recover from either.
        if (cancelled) return;
        setPhase("anonymous");
        if (!isLoginPage) router.replace("/admin/login");
      });

    return () => {
      cancelled = true;
    };
  }, [isLoginPage, router]);

  if (isLoginPage) return <>{children}</>;

  if (phase !== "authenticated") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return <>{children}</>;
}
