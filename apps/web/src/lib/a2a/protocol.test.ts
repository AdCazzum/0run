import { describe, expect, it } from "vitest";
import { consultDigest, signConsult, verifyConsult, MAX_SKEW_SEC, type ConsultPayload } from "./protocol";

// Deterministic test key: privateKeyToAccount(PK).address === SIGNER.
const PK = ("0x" + "01".padStart(64, "0")) as `0x${string}`;
const SIGNER = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const OTHER = "0x" + "42".repeat(20);

const payload: ConsultPayload = {
  from: "marco.0run.eth",
  to: "pedro.0run.eth",
  question: "Il mio atleta crolla al km 30 — come impostare i lunghi?",
  context: "ultimo lungo: 32km a 5:40/km",
  ts: 1_753_440_000,
  nonce: "n-1",
};

describe("consultDigest", () => {
  it("serializza le sei chiavi in ordine fisso, senza whitespace", () => {
    expect(consultDigest(payload)).toBe(
      `{"from":"marco.0run.eth","to":"pedro.0run.eth","question":${JSON.stringify(payload.question)},"context":${JSON.stringify(payload.context)},"ts":1753440000,"nonce":"n-1"}`,
    );
  });
});

describe("signConsult / verifyConsult", () => {
  it("roundtrip: una richiesta firmata verifica contro l'address del firmatario", async () => {
    const signed = await signConsult(payload, PK);
    const res = await verifyConsult(signed, { signer: SIGNER, selfName: "pedro.0run.eth" }, payload.ts);
    expect(res).toEqual({ ok: true });
  });

  it("firma di una chiave diversa dal record agent-signer → ok:false", async () => {
    const signed = await signConsult(payload, PK);
    const res = await verifyConsult(signed, { signer: OTHER, selfName: "pedro.0run.eth" }, payload.ts);
    expect(res).toMatchObject({ ok: false });
  });

  it("payload alterato dopo la firma → ok:false", async () => {
    const signed = await signConsult(payload, PK);
    const tampered = { ...signed, question: "domanda cambiata" };
    const res = await verifyConsult(tampered, { signer: SIGNER, selfName: "pedro.0run.eth" }, payload.ts);
    expect(res).toMatchObject({ ok: false });
  });

  it("ts fuori dalla finestra anti-replay → ok:false", async () => {
    const signed = await signConsult(payload, PK);
    const res = await verifyConsult(signed, { signer: SIGNER, selfName: "pedro.0run.eth" }, payload.ts + MAX_SKEW_SEC + 1);
    expect(res).toMatchObject({ ok: false });
  });

  it("`to` che non è il nome del ricevente → ok:false (no replay verso un altro coach)", async () => {
    const signed = await signConsult(payload, PK);
    const res = await verifyConsult(signed, { signer: SIGNER, selfName: "kilian.0run.eth" }, payload.ts);
    expect(res).toMatchObject({ ok: false });
  });

  it("confronti case-insensitive su signer e selfName", async () => {
    const signed = await signConsult(payload, PK);
    const res = await verifyConsult(signed, { signer: SIGNER.toLowerCase(), selfName: "PEDRO.0run.eth" }, payload.ts);
    expect(res).toEqual({ ok: true });
  });
});
