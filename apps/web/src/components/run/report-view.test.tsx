// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportView } from "./report-view";

const report = { headline: "Progressi veri", analysis: "Analisi lunga del passo.", comparison: "12s/km meglio di martedì", advice: ["Recupera 48h"] };

// This repo's vitest.config.ts does not set `test.globals: true`, so
// @testing-library/react's automatic afterEach(cleanup) (which relies on
// detecting a global `afterEach`) never registers — the two renders below
// would otherwise leak into each other's DOM (both badges share the text
// "TEE verified"/"attestation not available" markup), producing a false
// positive/negative unrelated to ReportView's own logic. Explicit cleanup
// isolates each `it()`, same fix needed regardless of which assertions run.
afterEach(cleanup);

describe("ReportView", () => {
  it("mostra headline serif, drop cap sull'analysis, badge TEE verified con link", () => {
    render(<ReportView report={report} verifiedTee="true" model="glm-5.2" registryTx="0xreg" gpxRoot="0xroot" />);
    expect(screen.getByText("Progressi veri").className).toContain("font-serif");
    expect(screen.getByTestId("drop-cap-paragraph").className).toContain("first-letter:float-left");
    expect(screen.getByText(/tee verified/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /memory tx/i }).getAttribute("href")).toContain("chainscan-galileo.0g.ai/tx/0xreg");
  });
  it("verifiedTee unavailable → badge neutro, nessun claim falso", () => {
    render(<ReportView report={report} verifiedTee="unavailable" model="glm-5.2" registryTx="0xreg" gpxRoot="0xroot" />);
    expect(screen.queryByText(/tee verified/i)).toBeNull();
    expect(screen.getByText(/attestation not available/i)).toBeTruthy();
  });
});
