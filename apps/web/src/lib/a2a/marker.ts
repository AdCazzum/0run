export type ConsultMarker = { coach: string; question: string };

const MARKER_RE = /<consult\s+coach="([^"]+)"\s*>([\s\S]*?)<\/consult>/g;

/**
 * The model has no tool-calling on 0G Compute (see lib/inference), so
 * "decide to consult a colleague" is expressed as an inline marker the chat
 * route parses out of the reply. First valid marker wins; every marker is
 * stripped from the visible text either way.
 */
export function parseConsultMarker(text: string): { marker: ConsultMarker | null; cleaned: string } {
  let marker: ConsultMarker | null = null;
  const cleaned = text
    .replace(MARKER_RE, (_m, coach: string, question: string) => {
      if (!marker && question.trim()) marker = { coach: coach.trim().toLowerCase(), question: question.trim() };
      return "";
    })
    .trim();
  return { marker, cleaned: marker ? cleaned : text };
}

/**
 * Appended to the chat system prompt only when colleagues exist, so a chat
 * with no consultable roster keeps the exact prompt it had before this
 * feature (same convention as prompts.ts's optional blocks).
 */
export function buildConsultInstruction(roster: { ensName: string; personality: string | null }[]): string {
  if (roster.length === 0) return "";
  const lines = roster.map((r) => `- ${r.ensName}${r.personality ? ` (personality: ${r.personality})` : ""}`);
  return [
    `You can consult ONE fellow coach when the question clearly benefits from a specialist's second opinion. Available colleagues (ENS identities):`,
    ...lines,
    `To consult, reply with ONLY this marker and nothing else: <consult coach="name.0run.eth">your question for the colleague, in their language</consult>`,
    `Use it sparingly — most questions you answer yourself.`,
  ].join("\n");
}
