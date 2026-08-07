import type { Metadata } from "next";
import AdminShell from "@/components/admin/admin-shell";
import { isAuthenticated } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Club admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const signedIn = await isAuthenticated();
  // The login page renders on its own; everything else gets the shell.
  if (!signedIn) return <>{children}</>;
  return <AdminShell>{children}</AdminShell>;
}
