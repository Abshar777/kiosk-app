"use client";

import { Button, Input, Label, TextField } from "@heroui/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, adminAuth } from "@/lib/api";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await adminAuth.login(password);
      // replace, not push: the back button should not return to a login form
      // that is now pointless.
      router.replace("/admin");
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError && caught.status === 401
          ? "That password was not recognised."
          : "Could not sign in. Is the API running?",
      );
      setPassword("");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-canvas flex min-h-screen items-center justify-center p-6">
      <div className="bg-surface rounded-card w-full max-w-sm p-8">
        <Image
          alt="Delta Academy"
          className="brand-logo mx-auto h-8 w-auto"
          height={186}
          priority
          src="/logo.png"
          width={433}
        />

        <h1 className="type-heading text-ink mt-6 text-center">Admin sign in</h1>
        <p className="type-body text-ink-muted mt-1 text-center">
          Enter the admin password to manage courses and enrolments.
        </p>

        <form className="mt-7" onSubmit={submit}>
          <TextField
            autoFocus
            className="w-full"
            isRequired
            onChange={setPassword}
            type="password"
            value={password}
          >
            <Label className="type-label text-ink mb-2 block">Password</Label>
            <Input className="min-h-14 w-full" placeholder="Admin password" />
          </TextField>

          {error !== null && (
            <p className="bg-bad-bg text-bad type-body rounded-control mt-4 p-3" role="alert">
              {error}
            </p>
          )}

          <Button
            className="mt-6 w-full"
            isDisabled={isSubmitting || password.length === 0}
            size="lg"
            type="submit"
            variant="primary"
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="type-caption text-ink-subtle mt-6 text-center">
          No password set? The API prints a generated one to its console at startup.
        </p>
      </div>
    </div>
  );
}
