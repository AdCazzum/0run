import type { Metadata } from "next";
import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { claims, events } from "@/db/schema";
import { Card } from "@/components/ui/card";
import { CreateEventForm } from "./create-event-form";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";

// Queries Postgres per request. Without this Next tries to prerender it at build
// time, which fails in CI (no database) and would freeze the data into the build
// even where it succeeds.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events — 0run",
  description: "Runner-created events, gated by World ID: one unique real person can claim each — not proof of attendance.",
};

const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" });

async function loadFeed() {
  const rows = await db.select().from(events).orderBy(desc(events.startsAt));
  return Promise.all(
    rows.map(async (e) => {
      const [c] = await db.select({ value: count() }).from(claims).where(eq(claims.eventId, e.id));
      return { ...e, claimCount: c?.value ?? 0 };
    }),
  );
}

export default async function EventsPage() {
  const feed = await loadFeed();

  return (
    <>
      <SiteHeader />
      <main className="relative mx-auto max-w-[1600px] px-8 py-20 md:px-16 md:py-32">
        <span
          aria-hidden
          className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block"
          style={{ writingMode: "vertical-rl" }}
        >
          0run / events
        </span>

        <div className="flex items-center gap-4">
          <span aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Run together</span>
        </div>

        <div className="mt-8 grid grid-cols-12 gap-x-8 gap-y-12">
          <div className="col-span-12 md:col-span-7">
            <h1 className="font-serif text-6xl leading-[0.9] text-navy md:text-8xl">
              Every <em className="font-serif italic text-orange">run</em>, together.
            </h1>
            <p className="mt-8 max-w-md font-sans text-lg leading-relaxed text-navy">
              A morning race, a Thursday group run, a challenge between friends. Anyone can start
              one, and anyone can join.
            </p>
            <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-ocean">
              To put your name on an event you prove you are a real person, once, with World ID —
              so the list is people, not accounts. It says you claimed the event, not that you ran
              it: we would rather tell you that than pretend the badge means more than it does.
            </p>
            {/* The call to action sits under the copy it belongs to, like the one
                on the home page. Off in its own right-hand column it read as
                floating debris rather than the next thing to do. */}
            <div className="mt-10">
              <CreateEventForm />
            </div>
          </div>
        </div>

        {feed.length === 0 ? (
          <section className="mt-24 border-t border-navy/15 pt-16">
            <p className="max-w-md font-sans text-lg leading-relaxed text-navy">
              No events yet — be the <em className="font-serif italic text-orange">first</em> to start one.
            </p>
          </section>
        ) : (
          <section className="mt-24 grid grid-cols-12 gap-x-8 gap-y-16 border-t border-navy/15 pt-16">
            {feed.map((e, i) => (
              <div key={e.id} className={i % 2 === 0 ? "col-span-12 md:col-span-7" : "col-span-12 md:col-span-6 md:col-start-7"}>
                <Link href={`/events/${e.id}`} className="block group">
                  <Card>
                    <div className="mb-6 flex items-center gap-4">
                      <span aria-hidden className="h-px w-8 bg-navy/40" />
                      <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-ocean">
                        {DAY.format(e.startsAt)}
                      </span>
                    </div>
                    <h2 className="font-serif text-3xl leading-tight text-navy transition-colors duration-500 group-hover:text-orange md:text-4xl">
                      {e.name}
                    </h2>
                    <p className="mt-6 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
                      {e.claimCount} {e.claimCount === 1 ? "person" : "people"} · each one verified, once
                    </p>
                  </Card>
                </Link>
              </div>
            ))}
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
