import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Job } from "../types.js";

/**
 * Named by the caller. Sonnet 4.6 is the previous generation: Sonnet 5
 * (`claude-sonnet-5`) is both newer and cheaper at $2/$10 per MTok, so it is
 * worth a look before a long run. Change MODEL and PRICING together.
 */
export const MODEL = "claude-sonnet-4-6";

/** USD per million tokens, from the Claude pricing table for this model. */
export const PRICING = {
  input: 3.0,
  output: 15.0,
  // cache writes cost ~1.25x input, reads ~0.1x
  cacheWrite: 3.75,
  cacheRead: 0.3,
} as const;

/** Descriptions run long; this keeps one job inside a sane prompt. */
const MAX_DESCRIPTION_CHARS = 12_000;

export type LlmScore = {
  fit: number;
  reasons: string[];
  concerns: string[];
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export type LlmScoreResult = LlmScore & {
  usage: Usage;
  /** true when the first response did not parse and the retry was used */
  retried: boolean;
};

const Response = z.object({
  fit: z.number(),
  reasons: z.array(z.string()),
  concerns: z.array(z.string()),
});

const SYSTEM = `You are screening job postings for one specific engineer, whose profile follows.

Judge what a keyword filter cannot:

1. Is this really a backend role, or a title that says backend over work that is not?
   Read the responsibilities, not the title.
2. Is the seniority a genuine match — not a level down dressed up, and not a
   management role in disguise?
3. Does this company look like somewhere a senior backend engineer with payments
   and ledger experience would do good work? Consider what they build, what the
   engineering problems actually are, and whether that experience is wanted here
   or incidental.
4. Are there hidden blockers? Location or residency restrictions stated in
   passing, an on-call or travel expectation, a stack the profile rules out, a
   contract or equity-only arrangement, a role that is really two jobs.

Scoring:
- fit is an integer from 0 to 100. 0 means do not apply. 100 means drop everything.
- Use the whole range. A generic-but-plausible backend role is a 50, not an 80.
- reasons: at most 3, why THIS job fits THIS profile. Cite specifics from the
  posting — the system, the domain, the stack. No generic praise.
- concerns: at most 3, what would make it a bad fit. Say "none apparent" as a
  single concern only if you genuinely found nothing.

Respond with JSON only. No prose, no markdown fence. Exactly this shape:
{"fit": <integer 0-100>, "reasons": ["..."], "concerns": ["..."]}`;

/**
 * The profile lives in a file at the repo root so it can be edited without
 * touching code. Read fresh per call: a long run should pick up an edit.
 */
export function readProfile(path?: string): string {
  const target = path ?? fileURLToPath(new URL("../../profile.md", import.meta.url));
  return readFileSync(target, "utf8");
}

function buildPrompt(job: Job, profile: string): string {
  const description = job.description.slice(0, MAX_DESCRIPTION_CHARS);
  const truncated = job.description.length > MAX_DESCRIPTION_CHARS ? "\n[description truncated]" : "";

  return `<profile>
${profile}
</profile>

<job>
Company: ${job.company}
Title: ${job.title}
Location: ${job.location ?? "not stated"}
Remote flag: ${job.remote}
Salary: ${job.salaryText ?? "not published"}
Source: ${job.source}
URL: ${job.url}

Description:
${description}${truncated}
</job>

Score this job against the profile. JSON only.`;
}

/**
 * Pull the JSON object out of a response that may have ignored the instruction
 * and wrapped it in a fence or a sentence. Returns null if nothing parses —
 * the caller retries once, then gives up.
 */
export function parseResponse(text: string): LlmScore | null {
  const candidates: string[] = [text.trim()];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }

    const parsed = Response.safeParse(value);
    if (!parsed.success) continue;

    return {
      // the model is told 0-100, but clamp rather than trust it
      fit: Math.max(0, Math.min(100, Math.round(parsed.data.fit))),
      reasons: parsed.data.reasons.map((r) => r.trim()).filter(Boolean).slice(0, 3),
      concerns: parsed.data.concerns.map((c) => c.trim()).filter(Boolean).slice(0, 3),
    };
  }

  return null;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function usageOf(message: Anthropic.Message): Usage {
  return {
    inputTokens: message.usage.input_tokens ?? 0,
    outputTokens: message.usage.output_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  };
}

const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export function costOf(usage: Usage): number {
  return (
    (usage.inputTokens * PRICING.input +
      usage.outputTokens * PRICING.output +
      usage.cacheWriteTokens * PRICING.cacheWrite +
      usage.cacheReadTokens * PRICING.cacheRead) /
    1_000_000
  );
}

let shared: Anthropic | null = null;

function defaultClient(): Anthropic {
  // the SDK resolves ANTHROPIC_API_KEY itself, but say so plainly if it is absent
  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  shared ??= new Anthropic();
  return shared;
}

export type ScoreOptions = {
  /** injectable for tests; defaults to a shared client */
  client?: Pick<Anthropic["messages"], "create"> | Anthropic;
  profile?: string;
};

function messagesOf(client: NonNullable<ScoreOptions["client"]>): Pick<Anthropic["messages"], "create"> {
  return "messages" in client ? client.messages : client;
}

/**
 * Ask the model to judge one job against the profile.
 *
 * Retries once, and only on an unparseable response — an API error is the
 * caller's to handle, and the SDK already retries those itself. The retry adds
 * the failed text back so the model can see what it did wrong.
 */
export async function scoreWithLlm(
  job: Job,
  profile: string,
  options: ScoreOptions = {},
): Promise<LlmScoreResult> {
  const messages = messagesOf(options.client ?? defaultClient());
  const prompt = buildPrompt(job, profile);

  let usage = EMPTY_USAGE;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      // the system block is identical for every job in a run, so it caches
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages:
        attempt === 0
          ? [{ role: "user", content: prompt }]
          : [
              { role: "user", content: prompt },
              {
                role: "user",
                content:
                  "That response was not valid JSON. Reply with the JSON object only — no fence, no commentary.",
              },
            ],
    };

    const message = (await messages.create(request)) as Anthropic.Message;
    usage = addUsage(usage, usageOf(message));

    if (message.stop_reason === "refusal") {
      throw new Error(`model refused to score this job (${message.stop_details?.category ?? "unknown"})`);
    }

    const parsed = parseResponse(textOf(message));
    if (parsed) return { ...parsed, usage, retried: attempt > 0 };
  }

  throw new Error("model did not return valid JSON after a retry");
}
