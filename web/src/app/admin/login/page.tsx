import { Suspense } from "react";

import { isLive } from "@/lib/config";

import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h2 className="text-xl font-semibold">Administrator sign-in</h2>
      <p className="mt-1 text-sm text-ink-2">Password plus an authenticator app code. Accounts are created by the project owner; there is no public sign-up.</p>
      <div className="mt-6">
        {isLive ? <Suspense><LoginForm /></Suspense> : <p className="text-sm text-ink-3">Sign-in is not needed in demo mode.</p>}
      </div>
    </div>
  );
}
