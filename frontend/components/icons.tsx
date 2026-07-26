/**
 * Inline icon set — no external icon package, so the kiosk has zero extra
 * network requests and the service worker has nothing more to cache.
 * All icons inherit `currentColor` and size from the `size` prop.
 */
type IconProps = {
  className?: string;
  size?: number;
};

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor" as const,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const SearchIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const CloseIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/** Points start-ward; flip with `rtl:rotate-180` where direction matters. */
export const ArrowLeftIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const CheckIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const ClockIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const GlobeIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
  </svg>
);

export const UserIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
);

export const CertificateIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="9" r="5" />
    <path d="m8.5 13.5-1 7L12 18l4.5 2.5-1-7" />
  </svg>
);

export const CalendarIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const DownloadIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
  </svg>
);

export const PrintIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M7 9V3h10v6M7 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
    <rect x="7" y="15" width="10" height="6" rx="1" />
  </svg>
);

export const UpiIcon = ({ className, size = 24 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12h16M12 4v16" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

export const CardIcon = ({ className, size = 24 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="5" width="20" height="14" rx="3" />
    <path d="M2 10h20M6 15h4" />
  </svg>
);

export const BankIcon = ({ className, size = 24 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 10 12 4l9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18" />
  </svg>
);

export const ShieldIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l7 3v6c0 4.2-2.9 7.8-7 9-4.1-1.2-7-4.8-7-9V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const AlertIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16.5v.01" />
  </svg>
);

export const SunIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ className, size = 20 }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />
  </svg>
);
