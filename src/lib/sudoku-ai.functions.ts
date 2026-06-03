import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const cellSchema = z.array(z.array(z.number().min(0).max(9)).length(9)).length(9);

const hintInput = z.object({
  puzzle: cellSchema,
  current: cellSchema,
});

const strategyInput = z.object({
  puzzle: cellSchema,
});

const scanInput = z.object({
  image: z
    .string()
    .min(50)
    .max(15_000_000)
    .regex(/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/),
});

type AIMsg =
  | { role: string; content: string }
  | { role: string; content: Array<{ type: string; text?: string; image_url?: { url: string } }> };

async function callAI(messages: AIMsg[], model = "google/gemini-3-flash-preview", extra: Record<string, unknown> = {}) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      ...extra,
    }),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error("Rate limit exceeded, please try again shortly.");
    if (res.status === 402) throw new Error("AI credits exhausted. Please add credits.");
    const t = await res.text().catch(() => "");
    throw new Error(`AI error: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function boardStr(b: number[][]) {
  return b.map((row) => row.map((v) => (v === 0 ? "." : v)).join(" ")).join("\n");
}

export const getHint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => hintInput.parse(d))
  .handler(async ({ data }) => {
    const content = await callAI([
      {
        role: "system",
        content:
          "You are a Sudoku tutor. Given a Sudoku board, find ONE next cell the player should solve and explain WHY using logical techniques (naked single, hidden single, locked candidates, box-line, etc). Be specific about row/column/box constraints. Keep under 90 words. Format: **(row, col) = N** then explanation. Rows and columns are 1-indexed.",
      },
      {
        role: "user",
        content: `Original puzzle:\n${boardStr(data.puzzle)}\n\nCurrent state:\n${boardStr(data.current)}\n\nGive me a hint for the next logical move.`,
      },
    ]);
    return { hint: content };
  });

export const getStrategy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => strategyInput.parse(d))
  .handler(async ({ data }) => {
    const content = await callAI([
      {
        role: "system",
        content:
          "You are a Sudoku expert. Briefly describe the overall strategy & techniques required to solve this puzzle (naked singles, hidden singles, pointing pairs, X-wing, etc). Keep under 100 words.",
      },
      { role: "user", content: `Puzzle:\n${boardStr(data.puzzle)}` },
    ]);
    return { strategy: content };
  });

export const scanSudoku = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => scanInput.parse(d))
  .handler(async ({ data }) => {
    const raw = await callAI(
      [
        {
          role: "system",
          content:
            "You are a precise OCR for Sudoku puzzles. Read every cell of the 9x9 grid extremely carefully. For each cell output a single digit 1-9, or 0 if the cell is empty. Common mistakes to AVOID: confusing 1 vs 7, 6 vs 8, 3 vs 8, 5 vs 6, 9 vs 4. Double-check each row and column do not contain the same digit twice — if they do, you misread a cell, recheck. Respond ONLY with strict JSON: {\"grid\": [[r1c1,r1c2,...,r1c9], ...9 rows total]}. No prose, no markdown, no code fences.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the Sudoku grid from this image. Empty cells = 0. Verify rows/columns/boxes contain no duplicate non-zero digits before responding." },
            { type: "image_url", image_url: { url: data.image } },
          ],
        },
      ],
      "google/gemini-2.5-pro",
      { response_format: { type: "json_object" } },
    );


    let parsed: any;
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Could not parse Sudoku from image. Try a clearer photo.");
    }
    const grid = parsed.grid ?? parsed.board ?? parsed;
    if (!Array.isArray(grid) || grid.length !== 9) {
      throw new Error("AI did not return a 9x9 grid.");
    }
    const out: number[][] = [];
    for (let r = 0; r < 9; r++) {
      const row = grid[r];
      if (!Array.isArray(row) || row.length !== 9) {
        throw new Error("AI did not return a 9x9 grid.");
      }
      const nr: number[] = [];
      for (let c = 0; c < 9; c++) {
        let n = Number(row[c]);
        // Coerce unreadable / non-digit values to 0 instead of failing the whole scan
        if (!Number.isInteger(n) || n < 0 || n > 9) n = 0;
        nr.push(n);
      }
      out.push(nr);

    }
    return { grid: out };
  });
