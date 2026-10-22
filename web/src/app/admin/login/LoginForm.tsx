"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";

// Email + password, then a TOTP authenticator code. First sign-in enrolls the authenticator.
export default function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/admin";
  const [step, setStep] = useState<"password" | "enroll" | "verify">("password");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sb = supabaseBrowser();

  async function afterPassword() {
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") return router.replace(next);
    const { data: factors } = await sb.auth.mfa.listFactors();
    const totp = factors?.totp?.[0];
    if (totp) { setFactorId(totp.id); setStep("verify"); return; }
    const { data, error: e } = await sb.auth.mfa.enroll({ factorType: "totp" });
    if (e) return setError(e.message);
    setFactorId(data.id); setQr(data.totp.qr_code); setStep("enroll");
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error: err } = await sb.auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    if (err) return setError("Sign-in failed.");
    setError(null);
    await afterPassword();
  }

  async function onCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!factorId) return;
    const code = String(new FormData(e.currentTarget).get("code"));
    const { error: err } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    if (err) return setError("That code did not work. Try the next one.");
    router.replace(next);
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {step === "password" && (
        <form onSubmit={onPassword} className="space-y-3">
          <input name="email" type="email" required autoComplete="username" placeholder="Email" className="block w-full rounded border border-line bg-surface p-2" />
          <input name="password" type="password" required autoComplete="current-password" placeholder="Password" className="block w-full rounded border border-line bg-surface p-2" />
          <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">Continue</button>
        </form>
      )}
      {step !== "password" && (
        <form onSubmit={onCode} className="space-y-3">
          {step === "enroll" && qr && (
            <div>
              <p className="text-sm">Scan this with an authenticator app, then enter the 6-digit code.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Authenticator enrollment QR code" className="mt-2 h-44 w-44 bg-white p-2" />
            </div>
          )}
          <input name="code" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" placeholder="6-digit code" className="block w-full rounded border border-line bg-surface p-2" />
          <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">Verify</button>
        </form>
      )}
    </div>
  );
}
