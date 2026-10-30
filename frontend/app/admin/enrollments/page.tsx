import type { Metadata } from "next";
import { EnrollmentsView } from "@/components/admin/EnrollmentsView";

export const metadata: Metadata = {
  title: "Enrollments — Admin",
};

export default function AdminEnrollmentsPage() {
  return <EnrollmentsView />;
}
