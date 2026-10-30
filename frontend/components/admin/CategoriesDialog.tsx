"use client";

import type { Category } from "@course-lms/shared";
import { Button, Input, Label, Modal, Skeleton, Spinner, Switch, TextField } from "@heroui/react";
import { useState } from "react";
import { AlertIcon, CloseIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/icons";
import {
  type AdminQueryResult,
  EmptyState,
  ErrorState,
} from "@/components/admin/primitives";
import { adminApi, ApiRequestError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";

/** 401 on an admin call means the cookie expired, so retrying cannot help. */
const describeFailure = (cause: unknown): string => {
  if (cause instanceof ApiRequestError && cause.status === 401)
    return "Your admin session has expired. Reload the page to sign in again.";
  return cause instanceof Error ? cause.message : String(cause);
};

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function CategoryRow({
  category,
  isBusy,
  onRename,
  onToggle,
  onDelete,
}: {
  category: Category;
  isBusy: boolean;
  /** Each resolves true only when the write landed, so a failed edit keeps the
   *  row open on the value the operator typed. */
  onRename: (name: string) => Promise<boolean>;
  onToggle: (isActive: boolean) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const isEditing = draftName !== null;
  const courseCount = category.courseCount ?? 0;

  /*
   * Delete confirms inline rather than through ConfirmDialog. The second tap
   * design.md §6 asks for is still there, but stacking a second modal on top of
   * this one would trap focus in the wrong layer on the kiosk's own browser.
   */
  if (isConfirmingDelete) {
    return (
      <div className="bg-bad-bg rounded-control flex flex-wrap items-center gap-3 p-4">
        <p className="type-body text-ink me-auto">
          Delete <span className="font-semibold">{category.name}</span>?
        </p>
        <Button
          className="min-h-11"
          isDisabled={isBusy}
          onPress={() => setIsConfirmingDelete(false)}
          variant="secondary"
        >
          {t("admin.action.cancel")}
        </Button>
        <Button
          className="min-h-11"
          isDisabled={isBusy}
          onPress={() => {
            void onDelete().then((ok) => {
              if (ok) setIsConfirmingDelete(false);
            });
          }}
          variant="danger"
        >
          {isBusy && <Spinner size="sm" />}
          {t("admin.action.delete")}
        </Button>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="bg-surface-sunken rounded-control flex flex-wrap items-end gap-3 p-4">
        <TextField
          className="min-w-48 flex-1"
          onChange={setDraftName}
          value={draftName}
        >
          <Label className="type-label text-ink mb-2 block">Name</Label>
          <Input className="min-h-14 w-full" />
        </TextField>
        <Button
          className="min-h-14"
          isDisabled={isBusy}
          onPress={() => setDraftName(null)}
          variant="secondary"
        >
          {t("admin.action.cancel")}
        </Button>
        <Button
          className="min-h-14"
          isDisabled={isBusy || draftName.trim().length < 2}
          onPress={() => {
            void onRename(draftName.trim()).then((ok) => {
              if (ok) setDraftName(null);
            });
          }}
          variant="primary"
        >
          {isBusy && <Spinner size="sm" />}
          {t("admin.action.save")}
        </Button>
      </div>
    );
  }

  return (
    <div className="border-hairline flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="type-body text-ink truncate">{category.name}</p>
        <p className="type-caption text-ink-subtle mt-0.5 tabular">
          {courseCount === 1 ? "1 course" : `${formatNumber(courseCount)} courses`}
        </p>
      </div>

      <Switch
        aria-label={`${category.name} — ${category.isActive ? t("admin.status.active") : t("admin.status.inactive")}`}
        isDisabled={isBusy}
        isSelected={category.isActive}
        onChange={(next) => void onToggle(next)}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>

      <Button
        aria-label={`${t("admin.action.edit")} ${category.name}`}
        className="min-h-11"
        isDisabled={isBusy}
        isIconOnly
        onPress={() => setDraftName(category.name)}
        variant="ghost"
      >
        <PencilIcon size={18} />
      </Button>
      <Button
        aria-label={`${t("admin.action.delete")} ${category.name}`}
        className="min-h-11"
        isDisabled={isBusy}
        isIconOnly
        onPress={() => setIsConfirmingDelete(true)}
        variant="ghost"
      >
        <TrashIcon size={18} />
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

export function CategoriesDialog({
  isOpen,
  onOpenChange,
  query,
  onCategoriesChanged,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Owned by CoursesView, which also needs the list for its filter and form. */
  query: AdminQueryResult<Category[]>;
  /** A rename reaches the denormalised `categoryName` on every course row. */
  onCategoriesChanged: () => void;
}) {
  const { t } = useI18n();
  const [newName, setNewName] = useState("");
  /** The id being written, or "new" for the create row — one at a time. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Every mutation refreshes from the server rather than patching locally:
   *  the API re-slugs on rename and recounts courses, and guessing both here
   *  would drift from what the kiosk actually serves. */
  const run = async (id: string, action: () => Promise<unknown>): Promise<boolean> => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      query.reload();
      onCategoriesChanged();
      return true;
    } catch (cause) {
      setError(describeFailure(cause));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const categories = query.data ?? [];

  return (
    <Modal.Backdrop
      isDismissable={busyId === null}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <Modal.Container className="p-4" placement="center" scroll="inside" size="md">
        <Modal.Dialog className="w-full">
          <Modal.Header className="flex items-start justify-between gap-4">
            <div>
              <Modal.Heading className="type-heading text-ink">Categories</Modal.Heading>
              <p className="type-caption text-ink-muted mt-1">
                A disabled category stays on its courses but drops out of the kiosk filter.
              </p>
            </div>
            <Button
              aria-label={t("admin.action.close")}
              className="min-h-11"
              isIconOnly
              onPress={() => onOpenChange(false)}
              variant="ghost"
            >
              <CloseIcon size={20} />
            </Button>
          </Modal.Header>

          <Modal.Body className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end gap-3">
              <TextField
                className="min-w-48 flex-1"
                onChange={setNewName}
                value={newName}
              >
                <Label className="type-label text-ink mb-2 block">New category</Label>
                <Input className="min-h-14 w-full" placeholder="Design" />
              </TextField>
              <Button
                className="min-h-14"
                isDisabled={busyId !== null || newName.trim().length < 2}
                onPress={() => {
                  void run("new", () => adminApi.createCategory(newName.trim())).then((ok) => {
                    if (ok) setNewName("");
                  });
                }}
                variant="primary"
              >
                {busyId === "new" ? <Spinner size="sm" /> : <PlusIcon size={18} />}
                {t("admin.action.create")}
              </Button>
            </div>

            {error !== null && (
              <p className="type-body text-bad flex items-start gap-2" role="alert">
                <AlertIcon size={18} />
                {error}
              </p>
            )}

            {query.isLoading && query.data === null ? (
              <div aria-busy="true" className="flex flex-col gap-3" role="status">
                <span className="sr-only">{t("admin.state.loading")}</span>
                {Array.from({ length: 4 }, (_, row) => (
                  <Skeleton className="h-12 w-full rounded-control" key={row} />
                ))}
              </div>
            ) : query.error ? (
              <ErrorState error={query.error} onRetry={query.reload} />
            ) : categories.length === 0 ? (
              <EmptyState
                body="Add one above — every course needs a category."
                title="No categories yet"
              />
            ) : (
              <div className="flex flex-col">
                {categories.map((category) => (
                  <CategoryRow
                    category={category}
                    isBusy={busyId === category.id}
                    key={category.id}
                    onDelete={() => run(category.id, () => adminApi.deleteCategory(category.id))}
                    onRename={(name) =>
                      run(category.id, () => adminApi.updateCategory(category.id, { name }))
                    }
                    onToggle={(isActive) =>
                      run(category.id, () => adminApi.updateCategory(category.id, { isActive }))
                    }
                  />
                ))}
              </div>
            )}
          </Modal.Body>

          <Modal.Footer>
            <Button
              className="min-h-14"
              isDisabled={busyId !== null}
              onPress={() => onOpenChange(false)}
              variant="secondary"
            >
              {t("admin.action.close")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
