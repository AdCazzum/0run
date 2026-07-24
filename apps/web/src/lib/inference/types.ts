export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export type CoachCompletion = { text: string; verified: boolean | null; model: string; path: "router" | "direct" };
