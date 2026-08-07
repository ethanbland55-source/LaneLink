import { redirect } from "next/navigation";
import LoginForm from "@/components/admin/login-form";
import { adminConfigured, isAuthenticated } from "@/lib/auth";
import OtterMark from "@/components/otter-mark";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await isAuthenticated()) redirect("/admin");
  const { next } = await searchParams;

  return (
    <div className="min-h-dvh bg-deep lane-lines flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <OtterMark className="h-16 w-16" />
          <h1 className="mt-5 text-white text-2xl">Club admin</h1>
          <p className="mt-2 text-brand-100/80 text-[0.92rem]">
            Sign in to publish results, newsletters and club pages.
          </p>
        </div>

        {adminConfigured ? (
          <LoginForm next={next} />
        ) : (
          <div className="card p-6 text-[0.92rem]">
            <p className="font-semibold text-brand-900">Admin isn't set up yet</p>
            <p className="mt-2 text-ink-600">
              Add <code>ADMIN_PASSWORD</code> and <code>AUTH_SECRET</code> to the environment
              variables in Vercel (or your local <code>.env</code>), then redeploy.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
