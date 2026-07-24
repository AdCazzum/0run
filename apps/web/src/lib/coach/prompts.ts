import { z } from "zod";
import type { CoachProfile, RunStats, RunSummary } from "@0run/shared";
import type { ChatMsg } from "../inference";

export const ReportSchema = z.object({
  headline: z.string().min(1),
  analysis: z.string().min(1),
  comparison: z.string().min(1),
  advice: z.array(z.string()).min(1).max(5),
});
export type Report = z.infer<typeof ReportSchema>;

export function systemPrompt(profile: CoachProfile): string {
  return [
    `You are ${profile.name}, an AI running coach. Personality: ${profile.styleNotes}`,
    `Athlete totals: ${profile.totals.runs} runs, ${profile.totals.km} km. Recent pace trend (sec/km, latest last): ${profile.paceTrend.join(", ") || "none"}.`,
    `Stay in character. Be specific with numbers. Answer in the user's language (Italian if unsure).`,
  ].join("\n");
}

export function buildReportMessages(profile: CoachProfile, recentRuns: RunSummary[], current: RunStats): ChatMsg[] {
  return [
    { role: "system", content: systemPrompt(profile) },
    {
      role: "user",
      content: [
        `Analyze today's run and compare it EXPLICITLY with the previous runs (cite concrete deltas, e.g. sec/km).`,
        `Today's run:\n${JSON.stringify(current, null, 1)}`,
        `Summaries of previous runs (latest last):\n${JSON.stringify(recentRuns.slice(-5), null, 1)}`,
        `Respond ONLY with JSON: {"headline": string, "analysis": string, "comparison": string, "advice": string[]} (max 4 advice).`,
      ].join("\n\n"),
    },
  ];
}

export function buildChatMessages(profile: CoachProfile, recentRuns: RunSummary[], history: ChatMsg[]): ChatMsg[] {
  return [
    { role: "system", content: `${systemPrompt(profile)}\nRecent runs:\n${JSON.stringify(recentRuns.slice(-5))}` },
    ...history.slice(-12),
  ];
}
