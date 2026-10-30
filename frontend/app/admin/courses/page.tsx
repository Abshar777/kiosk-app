import type { Metadata } from "next";
import { CoursesView } from "@/components/admin/CoursesView";

export const metadata: Metadata = {
  title: "Courses — Admin",
};

export default function AdminCoursesPage() {
  return <CoursesView />;
}
