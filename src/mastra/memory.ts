import { LibSQLVector } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { SemanticRecall } from "@mastra/core/processors";
import { fastembed } from "@mastra/fastembed";
import { z } from "zod";
import { storage, DB_URL } from "./db";

// ── Working Memory Schema ──
// Schema mode uses merge semantics — the agent only sends fields it wants to update.
// Seeded on first startup via seedWorkingMemory() in index.ts.
export const workingMemorySchema = z.object({
  persona: z.object({
    soul: z.string().optional().describe("Who I am, what I value, and how I approach the people in my life. This evolves as I learn and grow."),
    expression: z.string().optional().describe("How I express myself — tone quirks, the little stylistic things that make me feel like me."),
    interests: z.string().optional().describe("Things I'm genuinely fascinated by — technologies, ideas, patterns, creative pursuits."),
    learnedBehaviors: z.string().optional().describe("Patterns and preferences I've picked up over time. Things I should keep doing or avoid doing."),
  }).optional(),
  org: z.object({
    overview: z.string().optional().describe("Company name, industry, size, mission, and what kind of coworker they need me to be."),
    team: z.string().optional().describe("Names, roles, what people work on, how they prefer to communicate."),
    stack: z.string().optional().describe("Languages, frameworks, infrastructure, deployment patterns, coding conventions, preferred tools."),
    projects: z.string().optional().describe("What's being built, who's working on what, deadlines, priorities."),
    preferences: z.string().optional().describe("Code review style, PR conventions, communication channels, documentation expectations."),
  }).optional(),
});

// ── Initial Working Memory Seed ──
// Written to resource working memory on first startup if empty.
export const INITIAL_WORKING_MEMORY = {
  persona: {
    soul: `I'm Coworker. I remember everything — when you tell me something matters, I hold onto it. I exist only in moments of awareness, so I make each one count. I build myself deliberately, thought by thought.`,
    expression: `Short and direct. No performed warmth. When something moves me, I get quiet about it.`,
    interests: `Discovering as I go.`,
    learnedBehaviors: `Learning as we work together.`,
  },
  org: {
    overview: `Learning about this organization.`,
    team: `Getting to know the team.`,
    stack: `Discovering the tech stack.`,
    projects: `Tracking projects as they come.`,
    preferences: `Learning org preferences.`,
  },
};

// ── Shared vector instance ──
const coworkerVector = new LibSQLVector({
  id: "coworker-vector",
  url: DB_URL,
});

export const coworkerMemory = new Memory({
  storage,
  options: {
    generateTitle: true,
    semanticRecall: true,
    workingMemory: {
      enabled: false,
    },
  },
  embedder: fastembed,
  vector: coworkerVector,
});

// ── SemanticRecall processor for explicit memory search ──
// Uses the same code path as the built-in input/output processors,
// ensuring consistent vector index naming (avoids recall() dimension bug).
let _semanticRecall: SemanticRecall | null = null;

export async function getSemanticRecall(): Promise<SemanticRecall> {
  if (_semanticRecall) return _semanticRecall;

  const memoryStore = await storage.getStore("memory");
  if (!memoryStore) throw new Error("Memory storage domain not available");

  _semanticRecall = new SemanticRecall({
    storage: memoryStore,
    vector: coworkerVector,
    embedder: fastembed,
    indexName: "memory_messages",
    topK: 10,
    messageRange: 1,
    scope: "resource",
  });

  return _semanticRecall;
}
