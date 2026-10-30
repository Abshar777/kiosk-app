"use client";

import type {
  Batch,
  Category,
  Course,
  CourseLevel,
  CourseMode,
  Instructor,
} from "@course-lms/shared";
import { COURSE_LEVELS, COURSE_MODES } from "@course-lms/shared";
import {
  Button,
  Input,
  Label,
  ListBox,
  Modal,
  NumberField,
  Select,
  Spinner,
  Switch,
  TextArea,
  TextField,
} from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { AlertIcon, CloseIcon, PlusIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { adminApi, ApiRequestError, resolveImageUrl } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

/* -------------------------------------------------------------------------- */
/* Error-aware fields                                                         */
/* -------------------------------------------------------------------------- */

/*
 * These are the settings page's field vocabulary plus one thing a settings pane
 * never needs: a per-field message. The invalid fill and ring come from HeroUI's
 * own `isInvalid` state — globals.css already points its `--danger` at our
 * `--color-bad`, so passing the flag is cheaper and more consistent than
 * hand-rolling the treatment in design.md §7.2.
 */

/** Field-level validation messages, keyed by the names the API uses in
 *  `ApiRequestError.fields` so a server rejection can be merged in as-is. */
type Errors = Record<string, string>;

function FieldMessage({ message }: { message?: string }) {
  if (message === undefined) return null;
  return (
    <p className="type-caption text-bad mt-1.5 flex items-center gap-1.5">
      <AlertIcon size={14} />
      {message}
    </p>
  );
}

function TextInput({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  type = "text",
  inputMode,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "numeric" | "email" | "url";
  className?: string;
}) {
  return (
    <TextField
      className={`w-full ${className ?? ""}`}
      isInvalid={error !== undefined}
      onChange={onChange}
      type={type}
      value={value}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <Input className="min-h-14 w-full" inputMode={inputMode} placeholder={placeholder} />
      {hint !== undefined && error === undefined && (
        <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>
      )}
      <FieldMessage message={error} />
    </TextField>
  );
}

function TextAreaInput({
  label,
  value,
  onChange,
  error,
  hint,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  rows?: number;
}) {
  return (
    <TextField
      className="w-full sm:col-span-2"
      isInvalid={error !== undefined}
      onChange={onChange}
      value={value}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <TextArea className="type-body w-full" rows={rows} />
      {hint !== undefined && error === undefined && (
        <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>
      )}
      <FieldMessage message={error} />
    </TextField>
  );
}

/**
 * `null` is the empty number field, and NaN is how React Stately represents
 * "nothing typed" — mapping between the two keeps an optional price blank
 * instead of showing a 0 the operator never entered.
 */
function NumberInput({
  label,
  value,
  onChange,
  error,
  hint,
  minValue = 0,
  maxValue,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  error?: string;
  hint?: string;
  minValue?: number;
  maxValue?: number;
}) {
  return (
    <NumberField
      className="w-full"
      isInvalid={error !== undefined}
      maxValue={maxValue}
      minValue={minValue}
      onChange={(next) => onChange(Number.isNaN(next) ? null : next)}
      value={value ?? Number.NaN}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <NumberField.Group className="min-h-14 w-full">
        <NumberField.Input className="tabular w-full" />
        <NumberField.DecrementButton />
        <NumberField.IncrementButton />
      </NumberField.Group>
      {hint !== undefined && error === undefined && (
        <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>
      )}
      <FieldMessage message={error} />
    </NumberField>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  error?: string;
  placeholder?: string;
}) {
  return (
    // HeroUI v3 Select is controlled with value/onChange — React Aria's
    // selectedKey/onSelectionChange silently does nothing here.
    <Select
      className="w-full"
      isInvalid={error !== undefined}
      onChange={(key) => onChange(String(key ?? ""))}
      placeholder={placeholder}
      value={value}
    >
      <Label className="type-label text-ink mb-2 block">{label}</Label>
      <Select.Trigger className="min-h-14 w-full">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item id={option.id} key={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <FieldMessage message={error} />
    </Select>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="type-subheading text-ink">{title}</h3>
      {description !== undefined && (
        <p className="type-caption text-ink-muted mt-1">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Draft                                                                      */
/* -------------------------------------------------------------------------- */

interface BatchDraft {
  /**
   * React key only. A saved batch reuses its server id; a row the operator just
   * added gets a client-side one that is stripped from the payload, so the API
   * mints the real id rather than persisting our placeholder.
   */
  uid: string;
  id: string | null;
  label: string;
  startDate: string;
  endDate: string;
  days: string;
  time: string;
  seatsTotal: number | null;
  /** Kept as loaded so editing a batch never resets how many seats are taken. */
  seatsAvailable: number | null;
}

interface CourseDraft {
  name: string;
  shortDescription: string;
  fullDescription: string;
  learningOutcomes: string[];
  categoryId: string;
  mode: CourseMode;
  level: CourseLevel;
  durationWeeks: number | null;
  durationLabel: string;
  instructor: Instructor;
  batches: BatchDraft[];
  hasCertificate: boolean;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  imageUrl: string;
}

let batchUid = 0;
const nextUid = () => `batch-${++batchUid}`;

const toBatchDraft = (batch: Batch): BatchDraft => ({
  uid: nextUid(),
  id: batch.id,
  label: batch.label,
  startDate: batch.startDate,
  endDate: batch.endDate,
  days: batch.days,
  time: batch.time,
  seatsTotal: batch.seatsTotal,
  seatsAvailable: batch.seatsAvailable,
});

const emptyBatch = (): BatchDraft => ({
  uid: nextUid(),
  id: null,
  label: "",
  startDate: "",
  endDate: "",
  days: "",
  time: "",
  seatsTotal: null,
  seatsAvailable: null,
});

function toDraft(course: Course | null, fallbackCategoryId: string): CourseDraft {
  if (course === null) {
    return {
      name: "",
      shortDescription: "",
      fullDescription: "",
      learningOutcomes: [],
      categoryId: fallbackCategoryId,
      mode: "offline",
      level: "beginner",
      durationWeeks: null,
      durationLabel: "",
      instructor: { name: "", title: "", bio: "", avatarUrl: null },
      batches: [],
      hasCertificate: true,
      price: null,
      originalPrice: null,
      currency: "",
      imageUrl: "",
    };
  }

  return {
    name: course.name,
    shortDescription: course.shortDescription,
    fullDescription: course.fullDescription,
    learningOutcomes: [...course.learningOutcomes],
    categoryId: course.categoryId,
    mode: course.mode,
    level: course.level,
    durationWeeks: course.durationWeeks,
    durationLabel: course.durationLabel,
    instructor: { ...course.instructor },
    batches: course.batches.map(toBatchDraft),
    hasCertificate: course.hasCertificate,
    price: course.price,
    originalPrice: course.originalPrice,
    currency: course.currency,
    imageUrl: course.imageUrl,
  };
}

/**
 * Mirrors the bounds the API enforces, so an operator is told about a 200-word
 * blurb here rather than after a round trip that rejects the whole form.
 */
function validate(draft: CourseDraft): Errors {
  const errors: Errors = {};
  const len = (value: string) => value.trim().length;

  if (len(draft.name) < 3) errors.name = "Name must be at least 3 characters.";
  else if (len(draft.name) > 120) errors.name = "Name must be at most 120 characters.";

  if (len(draft.shortDescription) < 10)
    errors.shortDescription = "Short description must be at least 10 characters.";
  else if (len(draft.shortDescription) > 300)
    errors.shortDescription = "Short description must be at most 300 characters.";

  if (len(draft.fullDescription) < 20)
    errors.fullDescription = "Full description must be at least 20 characters.";
  else if (len(draft.fullDescription) > 5000)
    errors.fullDescription = "Full description must be at most 5000 characters.";

  if (draft.categoryId === "") errors.categoryId = "Select a category.";

  if (draft.durationWeeks === null) errors.durationWeeks = "Duration is required.";
  else if (draft.durationWeeks < 1 || draft.durationWeeks > 260)
    errors.durationWeeks = "Duration must be between 1 and 260 weeks.";

  if (draft.price === null) errors.price = "Price is required.";
  else if (draft.price < 0) errors.price = "Price cannot be negative.";

  if (draft.originalPrice !== null && draft.price !== null && draft.originalPrice < draft.price)
    errors.originalPrice = "Original price should be higher than the current price.";

  return errors;
}

/** Only non-empty rows are sent — a half-filled batch is a mistake, not data. */
function batchesPayload(batches: BatchDraft[]): Record<string, unknown>[] {
  return batches
    .filter((batch) => batch.label.trim() !== "" || batch.startDate !== "")
    .map((batch) => ({
      ...(batch.id === null ? {} : { id: batch.id }),
      label: batch.label.trim() === "" ? "Batch" : batch.label.trim(),
      startDate: batch.startDate,
      endDate: batch.endDate,
      days: batch.days,
      time: batch.time,
      seatsTotal: batch.seatsTotal ?? 0,
      ...(batch.seatsAvailable === null ? {} : { seatsAvailable: batch.seatsAvailable }),
    }));
}

function toPayload(draft: CourseDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    shortDescription: draft.shortDescription.trim(),
    fullDescription: draft.fullDescription.trim(),
    learningOutcomes: draft.learningOutcomes.map((entry) => entry.trim()).filter(Boolean),
    categoryId: draft.categoryId,
    mode: draft.mode,
    level: draft.level,
    durationWeeks: draft.durationWeeks,
    // Left out when blank so the API derives "N weeks" from the duration. It
    // only does that for an *absent* field: sending "" stores an empty label,
    // and the card then reads "Design · " with nothing after the separator.
    ...(draft.durationLabel.trim() === ""
      ? {}
      : { durationLabel: draft.durationLabel.trim() }),
    instructor: {
      name: draft.instructor.name.trim(),
      title: draft.instructor.title.trim(),
      bio: draft.instructor.bio.trim(),
      avatarUrl: draft.instructor.avatarUrl,
    },
    batches: batchesPayload(draft.batches),
    hasCertificate: draft.hasCertificate,
    price: draft.price,
    originalPrice: draft.originalPrice,
    // Left out when blank so the API falls back to the configured currency
    // rather than storing an empty ISO code.
    ...(draft.currency.trim() === "" ? {} : { currency: draft.currency.trim().toUpperCase() }),
    imageUrl: draft.imageUrl.trim(),
  };
}

/* -------------------------------------------------------------------------- */
/* Repeatable sub-editors                                                     */
/* -------------------------------------------------------------------------- */

function SwitchInput({
  label,
  hint,
  isSelected,
  onChange,
}: {
  label: string;
  hint?: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch
      className="bg-surface-sunken rounded-control flex w-full flex-col items-start p-4"
      isSelected={isSelected}
      onChange={onChange}
    >
      {/* A span, not <Label>: Switch.Content already renders the <label> that
          owns the hidden input, and a nested <label> swallows the tap. */}
      <Switch.Content className="flex min-h-10 w-full items-center gap-3">
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <span className="type-label text-ink">{label}</span>
      </Switch.Content>
      {hint !== undefined && <p className="type-caption text-ink-subtle mt-1.5">{hint}</p>}
    </Switch>
  );
}

function OutcomesEditor({
  outcomes,
  onChange,
}: {
  outcomes: string[];
  onChange: (next: string[]) => void;
}) {
  const replace = (index: number, value: string) =>
    onChange(outcomes.map((entry, i) => (i === index ? value : entry)));

  return (
    <div className="flex flex-col gap-3">
      {outcomes.length === 0 && (
        <p className="type-caption text-ink-subtle">
          No outcomes yet. These appear as the check-marked list on the course details screen.
        </p>
      )}

      {outcomes.map((outcome, index) => (
        <div className="flex items-end gap-3" key={index}>
          <TextInput
            label={`Outcome ${index + 1}`}
            onChange={(value) => replace(index, value)}
            placeholder="Build and deploy a production React app"
            value={outcome}
          />
          <Button
            aria-label={`Remove outcome ${index + 1}`}
            className="min-h-14"
            isIconOnly
            onPress={() => onChange(outcomes.filter((_, i) => i !== index))}
            variant="ghost"
          >
            <TrashIcon size={18} />
          </Button>
        </div>
      ))}

      <Button
        className="min-h-14 self-start"
        onPress={() => onChange([...outcomes, ""])}
        variant="secondary"
      >
        <PlusIcon size={18} />
        Add outcome
      </Button>
    </div>
  );
}

function BatchesEditor({
  batches,
  onChange,
}: {
  batches: BatchDraft[];
  onChange: (next: BatchDraft[]) => void;
}) {
  const patch = (uid: string, change: Partial<BatchDraft>) =>
    onChange(batches.map((batch) => (batch.uid === uid ? { ...batch, ...change } : batch)));

  return (
    <div className="flex flex-col gap-4">
      {batches.length === 0 && (
        <p className="type-caption text-ink-subtle">
          No batches yet. Without one the kiosk shows &ldquo;Batch dates announced soon&rdquo;.
        </p>
      )}

      {batches.map((batch, index) => (
        <div className="bg-surface-sunken rounded-control p-4" key={batch.uid}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="type-label text-ink-muted">Batch {index + 1}</p>
            <Button
              aria-label={`Remove batch ${index + 1}`}
              className="min-h-11"
              isIconOnly
              onPress={() => onChange(batches.filter((entry) => entry.uid !== batch.uid))}
              variant="ghost"
            >
              <TrashIcon size={18} />
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Label"
              onChange={(value) => patch(batch.uid, { label: value })}
              placeholder="Morning batch"
              value={batch.label}
            />
            <NumberInput
              label="Seats"
              maxValue={10_000}
              onChange={(value) =>
                patch(batch.uid, {
                  seatsTotal: value,
                  // Shrinking a batch must not leave more seats free than exist.
                  seatsAvailable:
                    batch.seatsAvailable === null || value === null
                      ? batch.seatsAvailable
                      : Math.min(batch.seatsAvailable, value),
                })
              }
              value={batch.seatsTotal}
            />
            {/*
              A native date input rather than HeroUI's DatePicker: Batch.startDate
              is a plain yyyy-mm-dd string, and the picker speaks
              @internationalized/date objects, so every read and write would need
              converting for no gain on an admin form.
            */}
            <TextInput
              label="Start date"
              onChange={(value) => patch(batch.uid, { startDate: value })}
              type="date"
              value={batch.startDate}
            />
            <TextInput
              label="End date"
              onChange={(value) => patch(batch.uid, { endDate: value })}
              type="date"
              value={batch.endDate}
            />
            <TextInput
              label="Days"
              onChange={(value) => patch(batch.uid, { days: value })}
              placeholder="Mon, Wed, Fri"
              value={batch.days}
            />
            <TextInput
              label="Time"
              onChange={(value) => patch(batch.uid, { time: value })}
              placeholder="18:00 - 20:00"
              value={batch.time}
            />
          </div>
        </div>
      ))}

      <Button
        className="min-h-14 self-start"
        onPress={() => onChange([...batches, emptyBatch()])}
        variant="secondary"
      >
        <PlusIcon size={18} />
        Add batch
      </Button>
    </div>
  );
}

function ImageField({
  imageUrl,
  onChange,
}: {
  imageUrl: string;
  onChange: (url: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const { url } = await adminApi.uploadImage(file);
      onChange(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="bg-surface-sunken rounded-image grid h-24 w-40 shrink-0 place-items-center overflow-hidden">
          {imageUrl.trim() === "" ? (
            <span className="type-caption text-ink-subtle">No image</span>
          ) : (
            /*
             * A plain <img>, not next/image: this field accepts any URL the
             * operator pastes, and next/image throws at runtime for a host
             * missing from remotePatterns. An admin preview must not crash.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="h-24 w-40 object-cover"
              src={resolveImageUrl(imageUrl.trim())}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset first, so picking the same file again still fires onChange.
              event.target.value = "";
              if (file) void upload(file);
            }}
            ref={inputRef}
            type="file"
          />
          <Button
            className="min-h-14"
            isDisabled={isUploading}
            onPress={() => inputRef.current?.click()}
            variant="secondary"
          >
            {isUploading ? <Spinner size="sm" /> : <UploadIcon size={18} />}
            {t("admin.action.upload")}
          </Button>
          {imageUrl.trim() !== "" && (
            <Button
              className="min-h-14"
              isDisabled={isUploading}
              onPress={() => onChange("")}
              variant="ghost"
            >
              <TrashIcon size={18} />
              Remove
            </Button>
          )}
        </div>
      </div>

      <TextInput
        hint="Or paste a URL — anything the kiosk browser can load."
        inputMode="url"
        label="Image URL"
        onChange={onChange}
        placeholder="https://… or /uploads/…"
        value={imageUrl}
      />

      {error !== null && <FieldMessage message={error} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

/** 401 on an admin call means the cookie expired, so retrying cannot help —
 *  say what will instead of repeating the server's generic refusal. */
const describeFailure = (error: ApiRequestError): string =>
  error.status === 401
    ? "Your admin session has expired. Reload the page to sign in again."
    : error.message;

export function CourseFormDialog({
  isOpen,
  onOpenChange,
  course,
  categories,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` opens the dialog in create mode. */
  course: Course | null;
  categories: Category[];
  onSaved: (course: Course, outcome: "created" | "updated") => void;
}) {
  const { t } = useI18n();
  const isEdit = course !== null;

  const [draft, setDraft] = useState<CourseDraft>(() => toDraft(null, ""));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed on every open so a cancelled edit never leaks into the next one.
  // `course` is keyed by identity, which is enough: the view hands over a fresh
  // object whenever the row it came from changed.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(toDraft(course, categories[0]?.id ?? ""));
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, course]);

  const edit = (change: Partial<CourseDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    // An edit invalidates the previous verdict, whoever issued it — including
    // the per-field message on the field being typed into. Validation only
    // runs on submit, so without this a fixed field keeps its red ring and its
    // "Price is required." until the operator presses Save again.
    setErrors((current) => {
      const next = { ...current };
      let changed = false;
      for (const key of Object.keys(change))
        if (key in next) {
          delete next[key];
          changed = true;
        }
      return changed ? next : current;
    });
    setFormError(null);
  };

  const editInstructor = (change: Partial<Instructor>) =>
    setDraft((current) => ({ ...current, instructor: { ...current.instructor, ...change } }));

  const submit = async () => {
    const found = validate(draft);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFormError("Some fields need attention before this can be saved.");
      return;
    }

    setErrors({});
    setFormError(null);
    setIsSaving(true);
    try {
      const payload = toPayload(draft);
      const saved = isEdit
        ? await adminApi.updateCourse(course.id, payload)
        : await adminApi.createCourse(payload);
      onSaved(saved, isEdit ? "updated" : "created");
      onOpenChange(false);
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        // Land server-side validation on the control it belongs to; the keys
        // match this form's field names by construction.
        setErrors(cause.fields);
        setFormError(describeFailure(cause));
      } else {
        setFormError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal.Backdrop isDismissable={!isSaving} isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container className="p-4" placement="center" scroll="inside" size="lg">
        <Modal.Dialog className="w-full">
          <Modal.Header className="flex items-start justify-between gap-4">
            <Modal.Heading className="type-heading text-ink">
              {isEdit ? "Edit course" : "Add course"}
            </Modal.Heading>
            <Button
              aria-label={t("admin.action.close")}
              className="min-h-11"
              isDisabled={isSaving}
              isIconOnly
              onPress={() => onOpenChange(false)}
              variant="ghost"
            >
              <CloseIcon size={20} />
            </Button>
          </Modal.Header>

          <Modal.Body className="flex flex-col gap-8">
            <FormSection
              description="What the student sees first on the listing card."
              title="Basics"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  className="sm:col-span-2"
                  error={errors.name}
                  label="Course name"
                  onChange={(value) => edit({ name: value })}
                  placeholder="Full-Stack Web Development"
                  value={draft.name}
                />
                <TextAreaInput
                  error={errors.shortDescription}
                  hint="Two lines at most — it is clamped on the card."
                  label="Short description"
                  onChange={(value) => edit({ shortDescription: value })}
                  rows={2}
                  value={draft.shortDescription}
                />
                <TextAreaInput
                  error={errors.fullDescription}
                  label="Full description"
                  onChange={(value) => edit({ fullDescription: value })}
                  rows={5}
                  value={draft.fullDescription}
                />
                <SelectInput
                  error={errors.categoryId}
                  label="Category"
                  onChange={(value) => edit({ categoryId: value })}
                  options={categories.map((category) => ({
                    id: category.id,
                    label: category.isActive ? category.name : `${category.name} (disabled)`,
                  }))}
                  placeholder="Select a category"
                  value={draft.categoryId}
                />
                <SelectInput
                  error={errors.mode}
                  label={t("course.mode")}
                  onChange={(value) => edit({ mode: value as CourseMode })}
                  options={COURSE_MODES.map((mode) => ({
                    id: mode,
                    label: t(`mode.${mode}` as TranslationKey),
                  }))}
                  value={draft.mode}
                />
                <SelectInput
                  error={errors.level}
                  label={t("course.level")}
                  onChange={(value) => edit({ level: value as CourseLevel })}
                  options={COURSE_LEVELS.map((level) => ({
                    id: level,
                    label: t(`level.${level}` as TranslationKey),
                  }))}
                  value={draft.level}
                />
                <NumberInput
                  error={errors.durationWeeks}
                  label="Duration (weeks)"
                  maxValue={260}
                  minValue={1}
                  onChange={(value) => edit({ durationWeeks: value })}
                  value={draft.durationWeeks}
                />
                <TextInput
                  className="sm:col-span-2"
                  error={errors.durationLabel}
                  hint="Shown on the card. Left blank, the API derives it from the weeks above."
                  label="Duration label"
                  onChange={(value) => edit({ durationLabel: value })}
                  placeholder="8 weeks"
                  value={draft.durationLabel}
                />
              </div>
            </FormSection>

            <FormSection title="Image">
              <ImageField imageUrl={draft.imageUrl} onChange={(url) => edit({ imageUrl: url })} />
            </FormSection>

            <FormSection
              description="Blank fields are simply left out of the details screen."
              title={t("course.instructor")}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label="Name"
                  onChange={(value) => editInstructor({ name: value })}
                  value={draft.instructor.name}
                />
                <TextInput
                  label="Title"
                  onChange={(value) => editInstructor({ title: value })}
                  placeholder="Senior Engineer, Delta Academy"
                  value={draft.instructor.title}
                />
                <TextAreaInput
                  label="Bio"
                  onChange={(value) => editInstructor({ bio: value })}
                  rows={3}
                  value={draft.instructor.bio}
                />
                <TextInput
                  className="sm:col-span-2"
                  inputMode="url"
                  label="Avatar URL"
                  onChange={(value) =>
                    editInstructor({ avatarUrl: value.trim() === "" ? null : value })
                  }
                  value={draft.instructor.avatarUrl ?? ""}
                />
              </div>
            </FormSection>

            <FormSection title={t("course.outcomes")}>
              <OutcomesEditor
                onChange={(next) => edit({ learningOutcomes: next })}
                outcomes={draft.learningOutcomes}
              />
            </FormSection>

            <FormSection title={t("course.batches")}>
              <BatchesEditor
                batches={draft.batches}
                onChange={(next) => edit({ batches: next })}
              />
            </FormSection>

            <FormSection title={t("course.price")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberInput
                  error={errors.price}
                  label="Price"
                  maxValue={10_000_000}
                  onChange={(value) => edit({ price: value })}
                  value={draft.price}
                />
                <NumberInput
                  error={errors.originalPrice}
                  hint="Struck through on the card. Leave blank when there is no discount."
                  label="Original price"
                  maxValue={10_000_000}
                  onChange={(value) => edit({ originalPrice: value })}
                  value={draft.originalPrice}
                />
                <TextInput
                  error={errors.currency}
                  hint="ISO code. Blank uses the currency from Settings."
                  label="Currency"
                  onChange={(value) => edit({ currency: value })}
                  placeholder="AED"
                  value={draft.currency}
                />
                <div className="flex items-end">
                  <SwitchInput
                    isSelected={draft.hasCertificate}
                    label={t("course.certificateYes")}
                    onChange={(value) => edit({ hasCertificate: value })}
                  />
                </div>
              </div>
            </FormSection>
          </Modal.Body>

          <Modal.Footer className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
            {formError !== null && (
              <p
                className="type-caption text-bad me-auto flex items-center gap-1.5"
                role="alert"
              >
                <AlertIcon size={14} />
                {formError}
              </p>
            )}
            <Button
              className="min-h-14"
              isDisabled={isSaving}
              onPress={() => onOpenChange(false)}
              variant="secondary"
            >
              {t("admin.action.cancel")}
            </Button>
            <Button
              className="min-h-14"
              isDisabled={isSaving}
              onPress={() => void submit()}
              variant="primary"
            >
              {isSaving && <Spinner size="sm" />}
              {isEdit ? t("admin.action.save") : t("admin.action.create")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

