import type { Metadata } from "next";
import { DashboardView } from "@/components/admin/DashboardView";

export const metadata: Metadata = {
  title: "Dashboard — Admin",
};

export default function AdminDashboardPage() {
  return <DashboardView />;
}
