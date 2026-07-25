import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

// processRun is fire-and-forget from the route's perspective (`void
// processRun(...)`), so mocking it lets these tests assert exactly what the
// route hands it — including the new `feelings` argument — without running
// the real pipeline (GPX parsing, 0G Storage, inference...). Declares the
// full parameter list (even though unused) so mock.calls[N][4] type-checks —
// a zero-arg mock infers an empty tuple and tsc rejects the index access
// (same fix as coach/chat/chat.test.ts's coachCompleteMock).
const processRunMock = vi.fn(async (
  _runId: number, _userId: number, _gpxXml: string, _userKey: Buffer, _feelings: string | null = null,
) => {});
vi.mock("@/lib/coach/pipeline", () => ({
  initialSteps: () => ({
    encrypt: { status: "pending" }, store_gpx: { status: "pending" }, update_memory: { status: "pending" },
    registry_tx: { status: "pending" }, score: { status: "pending" }, inference: { status: "pending" },
  }),
  processRun: processRunMock,
}));

const state: { inserted: any[] } = { inserted: [] };
vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      insert: (table: unknown) => ({
        values: (v: any) => ({
          returning: async () => {
            if (table !== schema.runs) return [];
            // createdAt is a column default in Postgres; populate it here too
            // (same discipline as api/events/events.test.ts's db fake).
            const row = { id: state.inserted.length + 1, createdAt: new Date(), ...v };
            state.inserted.push(row);
            return [row];
          },
        }),
      }),
      select: () => ({ from: () => ({ orderBy: async () => [], where: async () => [] }) }),
    },
  };
});

function req(form: FormData) {
  return new Request("http://x/api/runs", { method: "POST", headers: { authorization: "Bearer t" }, body: form });
}

function baseForm(extra?: Record<string, string>) {
  const form = new FormData();
  form.set("gpx", new File(["<gpx></gpx>"], "run.gpx", { type: "application/gpx+xml" }));
  form.set("userKeyHex", "aa".repeat(32));
  for (const [k, v] of Object.entries(extra ?? {})) form.set(k, v);
  return form;
}

describe("POST /api/runs", () => {
  beforeEach(() => {
    state.inserted = [];
    processRunMock.mockClear();
  });

  it("feelings presenti → passate (trimmed) a processRun", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(baseForm({ feelings: "  legs felt heavy  " })));
    expect(res.status).toBe(200);
    expect(processRunMock).toHaveBeenCalledTimes(1);
    expect(processRunMock.mock.calls[0][4]).toBe("legs felt heavy");
  });

  it("feelings assenti → il run funziona comunque, feelings null", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(baseForm()));
    expect(res.status).toBe(200);
    expect(processRunMock).toHaveBeenCalledTimes(1);
    expect(processRunMock.mock.calls[0][4]).toBeNull();
  });

  it("feelings solo whitespace → trattate come assenti", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(baseForm({ feelings: "   " })));
    expect(res.status).toBe(200);
    expect(processRunMock.mock.calls[0][4]).toBeNull();
  });

  it("feelings oltre 1000 caratteri → 400, processRun mai chiamata", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(baseForm({ feelings: "a".repeat(1001) })));
    expect(res.status).toBe(400);
    expect(processRunMock).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0); // no orphan "processing" row for a rejected upload
  });

  it("feelings esattamente a 1000 caratteri → accettate", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(baseForm({ feelings: "a".repeat(1000) })));
    expect(res.status).toBe(200);
    expect(processRunMock.mock.calls[0][4]).toBe("a".repeat(1000));
  });
});
