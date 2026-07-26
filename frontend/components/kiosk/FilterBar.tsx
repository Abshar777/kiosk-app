"use client";

import type { Category, CourseSort } from "@course-lms/shared";
import {
  COURSE_LEVELS,
  COURSE_MODES,
  COURSE_SORTS,
  DURATION_BUCKETS,
} from "@course-lms/shared";
import { Button, Chip, Label, ListBox, SearchField, Select } from "@heroui/react";
import { CloseIcon } from "@/components/icons";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

export interface Filters {
  q: string;
  category: string;
  mode: string;
  level: string;
  duration: string;
  sort: CourseSort;
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  category: "",
  mode: "",
  level: "",
  duration: "",
  sort: "popular",
};

const ALL = "__all__";

/**
 * HeroUI v3 Select is controlled with `value`/`onChange` — NOT React Aria's
 * `selectedKey`/`onSelectionChange`, which silently does nothing.
 */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
}) {
  const { t } = useI18n();
  return (
    <Select
      className="w-[168px] shrink-0"
      onChange={(key) => onChange(key === ALL ? "" : String(key ?? ""))}
      value={value === "" ? ALL : value}
    >
      <Label className="type-caption text-ink-muted mb-1.5 block">{label}</Label>
      <Select.Trigger className="min-h-14 w-full">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id={ALL} textValue={t("filter.all")}>
            {t("filter.all")}
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function FilterBar({
  filters,
  categories,
  onChange,
  onClear,
  resultCount,
  isPinned = false,
}: {
  filters: Filters;
  categories: Category[];
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  resultCount: number | null;
  /** When pinned the parent supplies the full-bleed surface, so drop the card. */
  isPinned?: boolean;
}) {
  const { t } = useI18n();

  const hasActiveFilters = Boolean(
    filters.category || filters.mode || filters.level || filters.duration || filters.q,
  );

  return (
    <div
      className={`kiosk-nonselectable ${
        isPinned ? "py-3" : "bg-surface rounded-card p-5"
      }`}
    >
      {/*
       * One row, always. On a narrow kiosk the row scrolls sideways rather than
       * wrapping — a second line pushes the course grid below the fold.
       */}
      <div className="scrollbar-thin -mx-1 flex items-end gap-3 overflow-x-auto px-1 pb-1">
        <SearchField
          className="w-[min(420px,45vw)] min-w-[240px] shrink-0 grow"
          onChange={(value) => onChange({ q: value })}
          value={filters.q}
        >
          <Label className="type-caption text-ink-muted mb-1.5 block">
            {t("listing.search")}
          </Label>
          <SearchField.Group className="min-h-14 w-full">
            <SearchField.SearchIcon />
            <SearchField.Input
              className="w-full text-[17px]"
              placeholder={t("listing.searchPlaceholder")}
            />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <FilterSelect
          label={t("filter.category")}
          onChange={(value) => onChange({ category: value })}
          options={categories.map((category) => ({
            id: category.slug,
            label: category.name,
          }))}
          value={filters.category}
        />

        <FilterSelect
          label={t("filter.mode")}
          onChange={(value) => onChange({ mode: value })}
          options={COURSE_MODES.map((mode) => ({
            id: mode,
            label: t(`mode.${mode}` as TranslationKey),
          }))}
          value={filters.mode}
        />

        <FilterSelect
          label={t("filter.level")}
          onChange={(value) => onChange({ level: value })}
          options={COURSE_LEVELS.map((level) => ({
            id: level,
            label: t(`level.${level}` as TranslationKey),
          }))}
          value={filters.level}
        />

        <FilterSelect
          label={t("filter.duration")}
          onChange={(value) => onChange({ duration: value })}
          options={DURATION_BUCKETS.map((bucket) => ({
            id: bucket.id,
            label: t(bucket.labelKey as TranslationKey),
          }))}
          value={filters.duration}
        />

        <FilterSelect
          label={t("filter.sort")}
          onChange={(value) => onChange({ sort: (value || "popular") as CourseSort })}
          options={COURSE_SORTS.map((sort) => ({
            id: sort,
            label: t(`sort.${sort}` as TranslationKey),
          }))}
          value={filters.sort}
        />
      </div>

      {hasActiveFilters && (
        <div className="border-hairline mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          {resultCount !== null && (
            <span className="type-caption text-ink-muted me-1">
              {resultCount === 1
                ? t("listing.resultsOne")
                : t("listing.resultsMany", { count: resultCount })}
            </span>
          )}

          {filters.q && <Chip size="sm" variant="soft">{`"${filters.q}"`}</Chip>}
          {filters.category && (
            <Chip size="sm" variant="soft">
              {categories.find((c) => c.slug === filters.category)?.name ?? filters.category}
            </Chip>
          )}
          {filters.mode && (
            <Chip size="sm" variant="soft">
              {t(`mode.${filters.mode}` as TranslationKey)}
            </Chip>
          )}
          {filters.level && (
            <Chip size="sm" variant="soft">
              {t(`level.${filters.level}` as TranslationKey)}
            </Chip>
          )}
          {filters.duration && (
            <Chip size="sm" variant="soft">
              {t(
                (DURATION_BUCKETS.find((b) => b.id === filters.duration)?.labelKey ??
                  "filter.duration") as TranslationKey,
              )}
            </Chip>
          )}

          <Button className="ms-auto" onPress={onClear} size="sm" variant="ghost">
            <CloseIcon size={16} />
            {t("listing.clearFilters")}
          </Button>
        </div>
      )}
    </div>
  );
}
