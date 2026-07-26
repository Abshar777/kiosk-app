"use client";

import type { Course } from "@course-lms/shared";
import { useEffect, useState } from "react";
import { ResponsiveDialog } from "@/components/ui/ResponsiveDialog";
import { CourseDetailsView } from "./CourseDetailsModal";
import { EnrollmentView } from "./EnrollmentFlow";

type View = "details" | "enroll";

/**
 * One overlay for the whole journey: course details → enrollment → payment →
 * confirmation.
 *
 * An earlier version used two sibling overlays and closed one to open the
 * other. That races React Aria's focus restoration — the second dialog would
 * mount while the first was still unmounting and be dismissed immediately.
 * Swapping the view inside a single dialog removes the race entirely, and it
 * is also the shorter path for the student.
 */
export function CourseFlowDialog({
  course,
  isOpen,
  onOpenChange,
  onDone,
}: {
  course: Course | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [view, setView] = useState<View>("details");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [isCharging, setIsCharging] = useState(false);

  // Each time a course is opened, start at its details with the first
  // available batch preselected.
  useEffect(() => {
    if (!course) return;
    setView("details");
    setIsCharging(false);
    setSelectedBatchId(course.batches.find((batch) => batch.seatsAvailable > 0)?.id ?? null);
  }, [course]);

  if (!course) return null;

  const isDetails = view === "details";

  return (
    <ResponsiveDialog
      // overflow-hidden clips the full-bleed hero image to the dialog's rounded
      // corners — without it the image spills past them in the mobile drawer.
      className={`w-full gap-0 overflow-hidden p-0 ${
        isDetails ? "max-w-[880px]" : "max-w-[600px]"
      }`}
      isDismissable={!isCharging}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (isCharging) return;
        onOpenChange(open);
      }}
    >
      {isDetails ? (
        <CourseDetailsView
          course={course}
          onEnroll={() => setView("enroll")}
          onSelectBatch={setSelectedBatchId}
          selectedBatchId={selectedBatchId}
        />
      ) : (
        // Keyed on the course so a fresh session never inherits state.
        <EnrollmentView
          batchId={selectedBatchId}
          course={course}
          key={course.id}
          onBack={() => setView("details")}
          onDone={onDone}
          onStageChange={(stage) => setIsCharging(stage === "processing")}
        />
      )}
    </ResponsiveDialog>
  );
}
