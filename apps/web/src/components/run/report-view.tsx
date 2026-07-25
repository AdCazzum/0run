import { explorerTx, storageExplorerRoot } from "@0run/shared";

type Report = { headline: string; analysis: string; comparison: string; advice: string[] };

export function ReportView({
  report, verifiedTee, model, registryTx, gpxRoot, effortScore = null, scoreVerified = null,
}: {
  report: Report; verifiedTee: string | null; model: string | null; registryTx: string | null; gpxRoot: string | null;
  // Attested effort score: a SEPARATE attestation from `verifiedTee` above —
  // it covers only the score (../lib/coach/score.ts), computed on the
  // TEE-verified "direct" 0G Compute path, independently of which path
  // produced the narrative report. Optional/nullable: that path can be
  // unavailable, which is not an error state for the run itself.
  effortScore?: number | null; scoreVerified?: string | null;
}) {
  return (
    <article className="max-w-xl">
      <div className="mb-6 flex items-center gap-4">
        <span aria-hidden className="h-px w-12 bg-navy" />
        <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Coach report</span>
      </div>
      <h1 className="font-serif text-5xl leading-[0.9] text-navy md:text-7xl">{report.headline}</h1>
      <p data-testid="drop-cap-paragraph"
         className="mt-10 font-sans text-lg leading-relaxed text-navy first-letter:float-left first-letter:mr-3 first-letter:font-serif first-letter:text-7xl first-letter:leading-[0.8]">
        {report.analysis}
      </p>
      <p className="mt-6 border-l border-orange pl-6 font-serif text-2xl italic text-navy">{report.comparison}</p>
      <ul className="mt-10 space-y-4">
        {report.advice.map((a, i) => (
          <li key={i} className="flex gap-4 font-sans text-base leading-relaxed text-navy">
            <span className="font-serif italic text-orange">{String(i + 1).padStart(2, "0")}</span>{a}
          </li>
        ))}
      </ul>
      <div className="mt-12 flex flex-wrap items-center gap-6 border-t border-navy/15 pt-6 font-sans text-[10px] uppercase tracking-[0.25em]">
        {verifiedTee === "true"
          ? <span className="text-orange">● TEE verified · {model}</span>
          : <span className="text-ocean">attestation not available · {model}</span>}
        {effortScore != null && (
          scoreVerified === "true"
            ? <span className="text-orange">● effort {effortScore}/5 · TEE verified</span>
            : <span className="text-ocean">effort {effortScore}/5 · attestation not available</span>
        )}
        {registryTx && <a className="text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline" href={explorerTx(registryTx)} target="_blank" rel="noopener noreferrer">memory tx ↗</a>}
        {gpxRoot && <a className="text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline" href={storageExplorerRoot(gpxRoot)} target="_blank" rel="noopener noreferrer">encrypted gpx ↗</a>}
      </div>
    </article>
  );
}
