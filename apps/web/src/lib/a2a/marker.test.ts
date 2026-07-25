import { describe, expect, it } from "vitest";
import { buildConsultInstruction, parseConsultMarker } from "./marker";

describe("parseConsultMarker", () => {
  it("estrae coach (lowercased) e domanda, e ripulisce il testo", () => {
    const text = `Ottima domanda.\n<consult coach="Pedro.0run.eth">Come imposti i lunghi oltre i 30km?</consult>`;
    const { marker, cleaned } = parseConsultMarker(text);
    expect(marker).toEqual({ coach: "pedro.0run.eth", question: "Come imposti i lunghi oltre i 30km?" });
    expect(cleaned).toBe("Ottima domanda.");
  });

  it("nessun marker → marker null, testo intatto", () => {
    const { marker, cleaned } = parseConsultMarker("Corri più piano nei recuperi.");
    expect(marker).toBeNull();
    expect(cleaned).toBe("Corri più piano nei recuperi.");
  });

  it("più marker → vale solo il primo, ma cleaned li rimuove tutti", () => {
    const text = `<consult coach="a.0run.eth">prima</consult> testo <consult coach="b.0run.eth">seconda</consult>`;
    const { marker, cleaned } = parseConsultMarker(text);
    expect(marker).toEqual({ coach: "a.0run.eth", question: "prima" });
    expect(cleaned).toBe("testo");
  });

  it("marker con domanda vuota → ignorato", () => {
    const { marker } = parseConsultMarker(`<consult coach="a.0run.eth">   </consult>`);
    expect(marker).toBeNull();
  });

  it("marker malformato (niente attributo coach) → ignorato, testo intatto", () => {
    const text = `<consult>chi?</consult> resto`;
    const { marker, cleaned } = parseConsultMarker(text);
    expect(marker).toBeNull();
    expect(cleaned).toBe(text);
  });
});

describe("buildConsultInstruction", () => {
  it("elenca i colleghi con nome ENS e personalità", () => {
    const out = buildConsultInstruction([
      { ensName: "pedro.0run.eth", personality: "drill-sergeant" },
      { ensName: "luna.0run.eth", personality: null },
    ]);
    expect(out).toContain("pedro.0run.eth");
    expect(out).toContain("drill-sergeant");
    expect(out).toContain("luna.0run.eth");
    expect(out).toContain('<consult coach="');
  });

  it("roster vuoto → stringa vuota (prompt byte-per-byte invariato)", () => {
    expect(buildConsultInstruction([])).toBe("");
  });
});
