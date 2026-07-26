"use client";

import Image from "next/image";
import { useState } from "react";
import { resolveImageUrl } from "@/lib/api";

/**
 * Course artwork with a generated fallback.
 *
 * A kiosk must render correctly with no network, so we never depend on a remote
 * image. When a course has no uploaded image — or the upload fails to load —
 * we draw a deterministic gradient cover derived from the course slug, so the
 * same course always gets the same artwork.
 */

const PALETTES = [
  ["#3ee9be", "#0e9f6e"],
  ["#7c9cf5", "#3f4857"],
  ["#f6c177", "#d97706"],
  ["#f39ba8", "#c2410c"],
  ["#a5b4fc", "#4338ca"],
  ["#67e8f9", "#0e7490"],
  ["#c4b5fd", "#6d28d9"],
  ["#fca5a5", "#b91c1c"],
] as const;

function hash(value: string): number {
  let out = 0;
  for (let i = 0; i < value.length; i++) out = (out * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(out);
}

function GeneratedCover({ name, slug }: { name: string; slug: string }) {
  const seed = hash(slug);
  const [from, to] = PALETTES[seed % PALETTES.length]!;
  const initials = name
    .split(/\s+/)
    .filter((word) => /[\p{L}]/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  // Deterministic blob positions keep the artwork varied but stable.
  const cx1 = 20 + (seed % 30);
  const cy1 = 25 + ((seed >> 3) % 30);
  const cx2 = 60 + ((seed >> 5) % 30);
  const cy2 = 55 + ((seed >> 7) % 30);

  return (
    <svg
      aria-hidden
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 160 90"
    >
      <defs>
        <linearGradient id={`g-${slug}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <rect fill={`url(#g-${slug})`} height="90" width="160" />
      <circle cx={cx1} cy={cy1} fill="#fff" opacity="0.12" r="26" />
      <circle cx={cx2} cy={cy2} fill="#fff" opacity="0.08" r="34" />
      <text
        dominantBaseline="central"
        fill="#fff"
        fontFamily="var(--font-sans), system-ui, sans-serif"
        fontSize="30"
        fontWeight="600"
        letterSpacing="-1"
        opacity="0.92"
        textAnchor="middle"
        x="80"
        y="47"
      >
        {initials}
      </text>
    </svg>
  );
}

export function CourseCover({
  imageUrl,
  name,
  slug,
  sizes,
}: {
  imageUrl: string;
  name: string;
  slug: string;
  sizes: string;
}) {
  const [hasFailed, setHasFailed] = useState(false);

  if (!imageUrl || hasFailed) return <GeneratedCover name={name} slug={slug} />;

  return (
    <Image
      alt=""
      className="object-cover"
      fill
      onError={() => setHasFailed(true)}
      sizes={sizes}
      src={resolveImageUrl(imageUrl)}
      unoptimized
    />
  );
}
