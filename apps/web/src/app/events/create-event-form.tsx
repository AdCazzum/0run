"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Inline creation form on the events feed. Deliberately open to any
 * logged-in user — see api/events/route.ts: events are permissionless by
 * design, the sybil resistance is entirely in the claim path.
 */
export function CreateEventForm() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button
        variant="primary"
        onClick={() => (ready && authenticated ? setOpen(true) : login())}
      >
        New event
      </Button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim() || !start || !end) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const startsAt = Math.floor(new Date(start).getTime() / 1000);
      const endsAt = Math.floor(new Date(end).getTime() / 1000);
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim(), startsAt, endsAt }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "could not create the event");
      router.push(`/events/${body.id}`);
    } catch (e: any) {
      setError(e.message ?? "something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm !p-6">
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Input placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} required />
        <div>
          <label className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">Starts</label>
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div>
          <label className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">Ends</label>
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        {error && <p className="font-sans text-sm text-orange">{error}</p>}
        <div className="flex gap-4">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "creating…" : "Create"}
          </Button>
          <Button type="button" variant="link" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
