"use client";

import type { Category, Course, Paginated } from "@course-lms/shared";
import { Button, Label, SearchField, Switch, Table } from "@heroui/react";
import { useEffect, useState } from "react";
import {
  AlertIcon,
  CheckCircleIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import { CategoriesDialog } from "@/components/admin/CategoriesDialog";
import { CourseFormDialog } from "@/components/admin/CourseFormDialog";
import { SelectSetting } from "@/components/admin/PosSettingsSection";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pager,
  TableSkeleton,
  Toolbar,
  useAdminQuery,
} from "@/components/admin/primitives";
import { adminApi, ApiRequestError } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

const PAGE_SIZE = 20;

/** Select needs a real key for "no filter": an empty value renders as the
 *  placeholder, which the operator then cannot choose their way back to. */
const ALL_CATEGORIES = "all";

/** 401 on an admin call means the cookie expired, so retrying cannot help —
 *  say what will instead of repeating the server's generic refusal. */
const describeFailure = (cause: unknown): string => {
  if (cause instanceof ApiRequestError && cause.status === 401)
    return "Your admin session has expired. Reload the page to sign in again.";
  return cause instanceof Error ? cause.message : String(cause);
};

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/** Holds a value still until it stops changing, so typing does not fire a
 *  request per keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

/** The three things that identify a request. Kept as one object so a filter
 *  change can reset the page in the same update, instead of firing a second
 *  fetch for a page that no longer exists. */
interface CoursesFilter {
  q: string;
  categoryId: string;
  page: number;
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                    */
/* -------------------------------------------------------------------------- */

type NoticeTone = "ok" | "warn" | "bad";

interface Notice {
  tone: NoticeTone;
  message: string;
}

const NOTICE_CLASS: Record<NoticeTone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
};

/**
 * Outcome of the last write. It sits above the table rather than in a toast
 * because the messages that land here are ones the operator has to read — the
 * server explaining that a course was disabled instead of deleted, or that
 * their session is gone.
 */
function NoticeBar({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const { t } = useI18n();

  return (
    <div
      className={`rounded-card mb-4 flex flex-wrap items-center gap-3 p-4 ${NOTICE_CLASS[notice.tone]}`}
      role="status"
    >
      {notice.tone === "ok" ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
      <p className="type-body me-auto">{notice.message}</p>
      <Button className="min-h-11" onPress={onDismiss} variant="ghost">
        {t("admin.action.close")}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

/** Replaces one row in the cached page, so a toggle needs no round trip. */
function patchRow(
  current: Paginated<Course> | null,
  id: string,
  change: Partial<Course>,
): Paginated<Course> | null {
  if (current === null) return current;
  return {
    ...current,
    items: current.items.map((item) => (item.id === id ? { ...item, ...change } : item)),
  };
}

export function CoursesView() {
  const { t } = useI18n();

  const [searchInput, setSearchInput] = useState("");
  const settledSearch = useDebounced(searchInput.trim(), 300);
  const [filter, setFilter] = useState<CoursesFilter>({
    q: "",
    categoryId: ALL_CATEGORIES,
    page: 1,
  });

  const [notice, setNotice] = useState<Notice | null>(null);
  const [isCategoriesOpen, setIsCategoriesOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  /** `null` while the form is open means create. */
  const [editing, setEditing] = useState<Course | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Course | null>(null);

  // Folding the settled term into the filter is also where the page resets:
  // page 3 of "design" means nothing once the term becomes "designer".
  useEffect(() => {
    setFilter((current) =>
      current.q === settledSearch ? current : { ...current, q: settledSearch, page: 1 },
    );
  }, [settledSearch]);

  const categoriesQuery = useAdminQuery<Category[]>(() => adminApi.categories());

  const coursesQuery = useAdminQuery<Paginated<Course>>(
    () =>
      adminApi.courses({
        q: filter.q,
        category: filter.categoryId === ALL_CATEGORIES ? undefined : filter.categoryId,
        page: filter.page,
        pageSize: PAGE_SIZE,
      }),
    [filter.q, filter.categoryId, filter.page],
  );

  const categories = categoriesQuery.data ?? [];
  const isFiltered = filter.q !== "" || filter.categoryId !== ALL_CATEGORIES;

  const clearFilters = () => {
    setSearchInput("");
    setFilter({ q: "", categoryId: ALL_CATEGORIES, page: 1 });
  };

  /** Flips the switch first and puts it back if the API disagrees — on a tablet
   *  a control that waits for the network reads as a missed tap. */
  const toggleActive = async (course: Course, isActive: boolean) => {
    setNotice(null);
    coursesQuery.setData((current) => patchRow(current, course.id, { isActive }));
    try {
      const saved = await adminApi.setCourseActive(course.id, isActive);
      coursesQuery.setData((current) => patchRow(current, course.id, saved));
    } catch (cause) {
      coursesQuery.setData((current) =>
        patchRow(current, course.id, { isActive: course.isActive }),
      );
      setNotice({ tone: "bad", message: describeFailure(cause) });
    }
  };

  /**
   * The API answers a delete with an outcome, not an error: a course with
   * enrollment history is disabled instead of removed, because the receipts
   * point at it. Either way its own sentence is what gets shown — a generic
   * "deleted" would be a lie half the time.
   *
   * Failures are caught here rather than rethrown so ConfirmDialog can close;
   * the message survives in the notice above the table.
   */
  const confirmDelete = async () => {
    if (pendingDelete === null) return;
    try {
      const result = await adminApi.deleteCourse(pendingDelete.id);
      setNotice({
        tone: result.outcome === "deleted" ? "ok" : "warn",
        message: result.message,
      });
      coursesQuery.reload();
    } catch (cause) {
      setNotice({ tone: "bad", message: describeFailure(cause) });
    }
  };

  const openCreate = () => {
    setEditing(null);
    setIsFormOpen(true);
  };

  const openEdit = (course: Course) => {
    setEditing(course);
    setIsFormOpen(true);
  };

  return (
    <div>
      <PageHeader
        actions={
          <>
            <Button
              className="min-h-14"
              onPress={() => setIsCategoriesOpen(true)}
              variant="secondary"
            >
              Manage categories
            </Button>
            <Button
              className="min-h-14"
              // A course cannot be filed without a category, so the form stays
              // shut until the list it needs is actually here.
              isDisabled={categories.length === 0}
              onPress={openCreate}
              variant="primary"
            >
              <PlusIcon size={18} />
              Add course
            </Button>
          </>
        }
        description="Everything the kiosk offers, including the courses currently switched off."
        title={t("admin.nav.courses")}
      />

      {notice !== null && <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />}

      {/* The categories list is what the filter and the form are built from, so
          its failure disables "Add course" and empties the filter. Said plainly
          here, because a silently dead button is read as a broken panel. */}
      {categoriesQuery.error !== null && (
        <div
          className={`rounded-card mb-4 flex flex-wrap items-center gap-3 p-4 ${NOTICE_CLASS.bad}`}
          role="alert"
        >
          <AlertIcon size={18} />
          <p className="type-body me-auto">
            {describeFailure(categoriesQuery.error)} Courses cannot be added or filtered by
            category until this loads.
          </p>
          <Button className="min-h-11" onPress={categoriesQuery.reload} variant="ghost">
            <RefreshIcon size={18} />
            {t("admin.action.retry")}
          </Button>
        </div>
      )}

      <Toolbar>
        <SearchField
          className="min-w-56 flex-1"
          onChange={setSearchInput}
          value={searchInput}
        >
          <Label className="type-label text-ink mb-2 block">{t("admin.action.search")}</Label>
          <SearchField.Group className="min-h-14 w-full">
            <SearchField.SearchIcon>
              <SearchIcon size={18} />
            </SearchField.SearchIcon>
            <SearchField.Input placeholder="Name, blurb, category or instructor" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <div className="min-w-48">
          <SelectSetting
            label={t("admin.action.filter")}
            onChange={(value) =>
              setFilter((current) => ({ ...current, categoryId: value, page: 1 }))
            }
            options={[
              { id: ALL_CATEGORIES, label: "All categories" },
              ...categories.map((category) => ({ id: category.id, label: category.name })),
            ]}
            value={filter.categoryId}
          />
        </div>

        {isFiltered && (
          <Button className="min-h-14" onPress={clearFilters} variant="ghost">
            {t("admin.action.clear")}
          </Button>
        )}
      </Toolbar>

      {coursesQuery.isLoading && coursesQuery.data === null ? (
        <TableSkeleton columns={7} rows={8} />
      ) : coursesQuery.error ? (
        <ErrorState error={coursesQuery.error} onRetry={coursesQuery.reload} />
      ) : (
        <>
          {/* A refetch keeps the previous page on screen rather than flashing a
              skeleton, so `aria-busy` is the only signal a screen reader gets. */}
          <Table
            aria-busy={coursesQuery.isLoading}
            className="bg-surface rounded-card overflow-hidden"
          >
            <Table.ScrollContainer>
              <Table.Content aria-label={t("admin.nav.courses")}>
                <Table.Header className="bg-surface-sunken">
                  <Table.Column className="type-label text-ink-muted" isRowHeader>
                    Course
                  </Table.Column>
                  <Table.Column className="type-label text-ink-muted">
                    {t("course.mode")}
                  </Table.Column>
                  <Table.Column className="type-label text-ink-muted">
                    {t("course.level")}
                  </Table.Column>
                  <Table.Column className="type-label text-ink-muted text-end">
                    {t("course.price")}
                  </Table.Column>
                  <Table.Column className="type-label text-ink-muted text-end">
                    Enrolments
                  </Table.Column>
                  <Table.Column className="type-label text-ink-muted">
                    {t("admin.status.active")}
                  </Table.Column>
                  <Table.Column className="type-label text-ink-muted text-end">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>

                <Table.Body
                  renderEmptyState={() =>
                    isFiltered ? (
                      <EmptyState
                        action={
                          <Button className="min-h-14" onPress={clearFilters} variant="secondary">
                            {t("admin.action.clear")}
                          </Button>
                        }
                        body="No course matches this search and category."
                        title="Nothing found"
                      />
                    ) : (
                      <EmptyState
                        action={
                          <Button
                            className="min-h-14"
                            isDisabled={categories.length === 0}
                            onPress={openCreate}
                            variant="primary"
                          >
                            <PlusIcon size={18} />
                            Add course
                          </Button>
                        }
                        body="Add the first one and it appears on the kiosk straight away."
                        title="No courses yet"
                      />
                    )
                  }
                >
                  {(coursesQuery.data?.items ?? []).map((course) => (
                    <Table.Row
                      className="border-hairline border-b last:border-b-0"
                      id={course.id}
                      key={course.id}
                    >
                      <Table.Cell className="py-4">
                        <p className="type-body text-ink font-semibold">{course.name}</p>
                        <p className="type-caption text-ink-subtle mt-0.5">
                          {course.categoryName} · {course.durationLabel}
                        </p>
                      </Table.Cell>

                      <Table.Cell className="type-body text-ink-muted py-4">
                        {t(`mode.${course.mode}` as TranslationKey)}
                      </Table.Cell>

                      <Table.Cell className="type-body text-ink-muted py-4">
                        {t(`level.${course.level}` as TranslationKey)}
                      </Table.Cell>

                      <Table.Cell className="type-body text-ink tabular py-4 text-end">
                        {formatCurrency(course.price, course.currency)}
                      </Table.Cell>

                      <Table.Cell className="type-body text-ink-muted tabular py-4 text-end">
                        {formatNumber(course.enrollmentCount)}
                      </Table.Cell>

                      <Table.Cell className="py-4">
                        <Switch
                          aria-label={`${course.name} — ${
                            course.isActive
                              ? t("admin.status.active")
                              : t("admin.status.inactive")
                          }`}
                          isSelected={course.isActive}
                          onChange={(next) => void toggleActive(course, next)}
                        >
                          <Switch.Content>
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                          </Switch.Content>
                        </Switch>
                      </Table.Cell>

                      <Table.Cell className="py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            aria-label={`${t("admin.action.edit")} ${course.name}`}
                            className="min-h-11"
                            isIconOnly
                            onPress={() => openEdit(course)}
                            variant="ghost"
                          >
                            <PencilIcon size={18} />
                          </Button>
                          <Button
                            aria-label={`${t("admin.action.delete")} ${course.name}`}
                            className="min-h-11"
                            isIconOnly
                            onPress={() => setPendingDelete(course)}
                            variant="ghost"
                          >
                            <TrashIcon size={18} />
                          </Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>

          <Pager
            onPageChange={(page) => setFilter((current) => ({ ...current, page }))}
            // The page we asked for, not the one the last response carried: a
            // refetch keeps the old page in `data`, so feeding that back would
            // leave the strip a click behind and make a second tap on Next
            // recompute the same page number. Pager clamps it to the total.
            page={filter.page}
            pageSize={coursesQuery.data?.pageSize ?? PAGE_SIZE}
            total={coursesQuery.data?.total ?? 0}
          />
        </>
      )}

      <CourseFormDialog
        categories={categories}
        course={editing}
        isOpen={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSaved={(saved, outcome) => {
          setNotice({
            tone: "ok",
            message:
              outcome === "created" ? `“${saved.name}” created.` : `“${saved.name}” saved.`,
          });
          // A new course may not belong on the page being viewed, and an edit
          // can move one out of the active filter, so refetch rather than patch.
          coursesQuery.reload();
        }}
      />

      <CategoriesDialog
        isOpen={isCategoriesOpen}
        onCategoriesChanged={() => {
          // `categoryName` is denormalised onto every course row, so a rename
          // here has to be re-read, not guessed at.
          coursesQuery.reload();
        }}
        onOpenChange={setIsCategoriesOpen}
        query={categoriesQuery}
      />

      <ConfirmDialog
        body={
          pendingDelete === null ? undefined : (
            <>
              <p>
                Delete <span className="font-semibold">{pendingDelete.name}</span>?
              </p>
              {pendingDelete.enrollmentCount > 0 && (
                <p className="mt-2">
                  It has {formatNumber(pendingDelete.enrollmentCount)} enrolment
                  {pendingDelete.enrollmentCount === 1 ? "" : "s"}, so it will be disabled
                  instead of removed.
                </p>
              )}
            </>
          )
        }
        confirmLabel={t("admin.action.delete")}
        isOpen={pendingDelete !== null}
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("admin.action.delete")}
      />
    </div>
  );
}
