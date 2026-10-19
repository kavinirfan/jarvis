"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Dashboard } from "./Dashboard";
import { Orb } from "./Orb";

type Me = { user: { id: string; email: string; displayName: string; admin: boolean } | null };

/** Client gate: shows the dashboard for signed-in users, otherwise sends them to /login. */
export function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Me>("/api/auth/me")
      .then((r) => {
        if (!r.user) window.location.replace("/login");
        else setMe(r);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error)
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="space-y-2">
          <p className="text-bad">{error}</p>
          <button className="text-sm text-accent underline" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  if (!me?.user)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Orb phase="starting" level={0} size={160} />
      </div>
    );
  return <Dashboard user={me.user} />;
}
