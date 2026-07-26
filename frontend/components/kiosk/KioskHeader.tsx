"use client";

import { Button } from "@heroui/react";
import Image from "next/image";
import { useConfig } from "@/app/providers";
import { GlobeIcon } from "@/components/icons";
import { LOCALE_NAMES, type Locale } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

/**
 * A flat, full-bleed white bar separated from the canvas by a single hairline.
 *
 * An earlier version wrapped this in a dark bezel strip with rounded bottom
 * corners (per the Tabby reference). At kiosk width the rounding read as
 * notched corners against the dark strip rather than as a deliberate card, so
 * the chrome was removed — the surface contrast alone does the separating.
 */
export function KioskHeader() {
  const { config } = useConfig();
  const { locale, setLocale, t } = useI18n();

  const available = (config.kiosk.availableLanguages as Locale[]).filter(
    (code) => code in LOCALE_NAMES,
  );
  // Cycle through configured languages; with two it behaves as a plain toggle.
  const nextLocale =
    available[(available.indexOf(locale) + 1) % Math.max(1, available.length)] ?? "en";

  return (
    <header className="bg-surface border-hairline kiosk-nonselectable border-b">
      <div>
        <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between gap-4 px-5 md:h-[88px] md:px-10">
          <div className="flex min-w-0 items-center gap-3">
            {config.academy.logoUrl ? (
              <Image
                alt={config.academy.name}
                className="h-9 w-auto shrink-0 md:h-10"
                height={186}
                priority
                src={config.academy.logoUrl}
                width={433}
              />
            ) : (
              <Image
                alt={config.academy.name}
                className="brand-logo h-9 w-auto shrink-0 md:h-10"
                height={186}
                priority
                src="/logo.png"
                width={433}
              />
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* No theme switcher: a kiosk runs one fixed look, chosen by the
                operator, not by whoever walks up to it. The dark tokens still
                exist and follow the OS setting. */}
            {available.length > 1 && (
              <Button
                aria-label={`${t("nav.language")}: ${LOCALE_NAMES[nextLocale]}`}
                className="bg-surface-accent text-ink h-12 gap-2 rounded-full px-5 font-semibold"
                onPress={() => setLocale(nextLocale)}
                variant="ghost"
              >
                <GlobeIcon size={18} />
                {LOCALE_NAMES[nextLocale]}
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
