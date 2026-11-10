"use client";

import { useEffect, useState } from "react";
import { WifiOffIcon } from "@/components/icons";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Tells the student the kiosk cannot reach the server.
 *
 * Deliberately non-blocking: browsing cached screens still works, and the real
 * failure arrives with a clear message at the point they try to enrol. Hiding
 * the whole interface behind a modal would be a worse trade.
 */
export function OfflineBanner() {
  const { t } = useI18n();
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // navigator.onLine only reports a link, not reachability, so this catches
    // the cable being pulled rather than the server being down. The flow's own
    // error handling covers the rest.
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      className="bg-warn-bg text-warn type-body fixed inset-x-0 bottom-0 z-50 flex items-center justify-center gap-2 p-3 text-center"
      role="status"
    >
      <WifiOffIcon size={18} />
      {t("pwa.offline")}
    </div>
  );
}
