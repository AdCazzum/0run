import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { GALILEO, explorerTx } from "@0run/shared";
import { db } from "@/db";
import { claims, events, users } from "@/db/schema";
import { ClaimWidget } from "./claim-widget";

const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function loadEvent(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [event] = await db.select().from(events).where(eq(events.id, id));
  if (!event) return null;
  const crew = await db
    .select({ nullifierHash: claims.nullifierHash, txHash: claims.txHash, createdAt: claims.createdAt, wallet: users.wallet })
    .from(claims)
    .innerJoin(users, eq(claims.userId, users.id))
    .where(eq(claims.eventId, event.id))
    .orderBy(desc(claims.createdAt));
  return { event, crew };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await loadEvent(id);
  if (!data) return { title: "Event not found — 0run" };
  return { title: `${data.event.name} — 0run events` };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadEvent(id);
  if (!data) notFound();
  const { event, crew } = data;

  return (
    <main className="relative mx-auto max-w-[1600px] px-8 py-20 md:px-16 md:py-32">
      <div className="flex items-center gap-4">
        <span aria-hidden className="h-px w-12 bg-navy" />
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">{DAY.format(event.startsAt)}</span>
      </div>

      <div className="mt-8 grid grid-cols-12 gap-x-8 gap-y-12">
        <div className="col-span-12 md:col-span-7">
          <h1 className="font-serif text-6xl leading-[0.9] text-navy md:text-7xl">{event.name}</h1>
          <p className="mt-8 max-w-md font-sans text-lg leading-relaxed text-navy">
            Runs until <em className="font-serif italic text-orange">{DAY.format(event.endsAt)}</em>. Anyone could have
            created this event — a claim proves one unique, World-ID-verified human, never that they were physically here.
          </p>

          <div className="mt-16">
            <ClaimWidget dbEventId={event.id} onchainEventId={event.onchainId} />
          </div>
        </div>

        <dl className="col-span-12 space-y-8 border-t border-navy pt-8 md:col-span-4 md:col-start-9">
          <Row label="chain">{GALILEO.name} · {GALILEO.chainId}</Row>
          <Row label="on-chain event">#{event.onchainId}</Row>
          {process.env.RUN_EVENTS_ADDRESS && (
            <Row label="RunEvents contract">
              <Ext href={`${GALILEO.explorer}/address/${process.env.RUN_EVENTS_ADDRESS}`}>{short(process.env.RUN_EVENTS_ADDRESS)} ↗</Ext>
            </Row>
          )}
          <Row label="created">
            <Ext href={explorerTx(event.txHash)}>{short(event.txHash)} ↗</Ext>
          </Row>
        </dl>
      </div>

      <section className="mt-24 border-t border-navy/15 pt-16">
        <div className="flex items-center gap-4">
          <span aria-hidden className="h-px w-8 bg-navy/40" />
          <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-ocean">
            The crew · {crew.length} {crew.length === 1 ? "person" : "people"}
          </span>
        </div>

        {crew.length === 0 ? (
          <p className="mt-8 max-w-md font-sans text-sm leading-relaxed text-ocean">
            No one has claimed this event yet.
          </p>
        ) : (
          <ul className="mt-10 grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {crew.map((c, i) => (
              <li key={i} className="group flex flex-col items-start gap-3">
                <span
                  aria-hidden
                  className="flex aspect-square w-full items-center justify-center border border-navy/20 bg-peach/40 font-serif text-2xl italic text-navy grayscale transition-all duration-[1500ms] group-hover:grayscale-0 group-hover:text-orange"
                >
                  {c.wallet.slice(2, 4).toUpperCase()}
                </span>
                {c.txHash ? (
                  <Ext href={explorerTx(c.txHash)}>{short(c.wallet)} ↗</Ext>
                ) : (
                  <span className="font-sans text-xs text-ocean">{short(c.wallet)}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-16 max-w-2xl border-t border-navy/15 pt-8 font-sans text-sm leading-relaxed text-ocean">
          Honest trust model: anyone can create an event on 0run, so a claim proves{" "}
          <em className="font-serif italic text-navy">one unique real person per event</em> — verified once, non-transferably,
          via World ID — not that they were physically present. Treat the crew above as "people who showed up to claim this
          online", not an attendance log.
        </p>
      </section>

      <div className="mt-24 border-t border-navy/15 pt-10">
        <Link
          href="/events"
          className="inline-block py-3 font-sans text-xs uppercase tracking-[0.2em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
        >
          ← All events
        </Link>
      </div>
    </main>
  );
}

function short(hex: string) {
  return hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">{label}</dt>
      <dd className="mt-2 font-sans text-sm text-navy">{children}</dd>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
    >
      {children}
    </a>
  );
}
