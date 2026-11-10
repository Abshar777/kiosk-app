"use client";

import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import { CloseIcon, DownloadIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/provider";

/** Chrome's install event, which TypeScript's DOM lib does not describe. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "kiosk.installDismissed";

/**
 * Offers to install the kiosk as an app.
 *
 * Shown to the person setting the kiosk up, not to students — once installed,
 * or once dismissed, it never appears again. A standing banner in front of a
 * queue of students would be noise at best.
 */
export function InstallPrompt() {
  const { t } = useI18n();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Already running as an installed app: nothing to offer.
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    try {
      if (window.localStorage.getItem(DISMISSED_KEY) === "true") return;
    } catch {
      // Private mode or blocked storage — showing the prompt is the safe side.
    }

    const onBeforeInstall = (event: Event) => {
      // Chrome shows its own mini-infobar otherwise, which we cannot style and
      // which appears at unpredictable moments.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDeferred(null);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Not worth surfacing; the prompt simply returns on the next load.
    }
  };

  if (!deferred) return null;

  return (
    <div className="bg-surface rounded-card fixed bottom-4 end-4 z-50 flex max-w-sm items-center gap-3 p-4 shadow-[var(--shadow-modal)]">
      <span className="min-w-0">
        <span className="type-label text-ink block">{t("pwa.installTitle")}</span>
        <span className="type-caption text-ink-muted block">{t("pwa.installBody")}</span>
      </span>

      <Button
        className="shrink-0"
        onPress={async () => {
          const event = deferred;
          setDeferred(null);
          await event.prompt();
          const { outcome } = await event.userChoice;
          // Declining is an answer: do not ask again on this device.
          if (outcome === "dismissed") dismiss();
        }}
        size="sm"
        variant="primary"
      >
        <DownloadIcon size={16} />
        {t("pwa.install")}
      </Button>

      <button
        aria-label={t("admin.action.close")}
        className="text-ink-muted hover:bg-surface-sunken grid h-9 w-9 shrink-0 place-items-center rounded-full transition"
        onClick={dismiss}
        type="button"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}
