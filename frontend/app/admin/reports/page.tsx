import type { Metadata } from "next";
import { ReportsView } from "@/components/admin/ReportsView";

export const metadata: Metadata = {
  title: "Reports — Admin",
};

export default function AdminReportsPage() {
  return <ReportsView />;
}
