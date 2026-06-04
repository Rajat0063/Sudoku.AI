import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/* ──────────────────────────────────────────────────────────────────────────
   AI PROVIDER CONFIGURATION
   ──────────────────────────────────────────────────────────────────────────
   This file calls OpenAI directly. You must provide your OWN API key.

   HOW TO ADD YOUR KEY:
     1. Get a key at https://platform.openai.com/api-keys
     2. Put it in the project's .env file at the repo root as:
            OPENAI_API_KEY="sk-..."
        (It MUST start with OPENAI_API_KEY=, no VITE_ prefix — this is a
        server-only secret and is never shipped to the browser.)
     3. Restart the dev server so the new env var is picked up.
     4. For production deployment, set OPENAI_API_KEY in your hosting
        provider's environment variables (Vercel / Cloudflare / etc.).

   Models used:
     • Hints / strategy text  → gpt-4o-mini  (cheap, fast)
     • Image OCR (scan)       → gpt-4o       (vision)

   You can swap these for any OpenAI-compatible endpoint by changing
   OPENAI_BASE_URL and the model names below.
   ────────────────────────────────────────────────────────────────────────── */

const cellSchema = z
  .array(z.array(z.number().min(0).max(9)).length(9))
  .length(9);

const hintInput = z.object({ puzzle: cellSchema, current: cellSchema });
const strategyInput = z.object({ puzzle: cellSchema });
const scanInput = z.object({
  image: z
    .string()
    .min(50)
    .max(15_000_000)
    .regex(/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/),
});

// Local hint/strategy helpers (no external AI required)
function candidatesForCell(board: number[][], row: number, col: number) {
  if (board[row][col] !== 0) return [];
  const used = new Set<number>();
  for (let c = 0; c < 9; c++) used.add(board[row][c]);
  for (let r = 0; r < 9; r++) used.add(board[r][col]);
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++)
    for (let c = bc; c < bc + 3; c++) used.add(board[r][c]);
  const candidates: number[] = [];
  for (let n = 1; n <= 9; n++) if (!used.has(n)) candidates.push(n);
  return candidates;
}

function boardStr(b: number[][]) {
  return b
    .map((row) => row.map((v) => (v === 0 ? "." : v)).join(" "))
    .join("\n");
}

export const getHint = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => hintInput.parse(d))
  .handler(async ({ data }) => {
    const { puzzle, current } = data;
    // 1) Naked single
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (current[r][c] === 0) {
          const cand = candidatesForCell(current, r, c);
          if (cand.length === 1) {
            const n = cand[0];
            const hint = `(${r + 1}, ${c + 1}) = ${n} — naked single (only candidate for that cell).`;
            return { hint, row: r, col: c, value: n };
          }
        }
      }
    }

    // 2) Hidden single (row/col/box)
    // check rows
    for (let r = 0; r < 9; r++) {
      const counts = new Map<number, number[]>();
      for (let c = 0; c < 9; c++)
        if (current[r][c] === 0) {
          const cand = candidatesForCell(current, r, c);
          for (const n of cand) {
            const arr = counts.get(n) || [];
            arr.push(c);
            counts.set(n, arr);
          }
        }
      for (const [n, arr] of counts.entries()) {
        if (arr.length === 1)
          return {
            hint: `(${r + 1}, ${arr[0] + 1}) = ${n} — hidden single in row ${r + 1}.`,
            row: r,
            col: arr[0],
            value: n,
          };
      }
    }

    // check columns
    for (let c = 0; c < 9; c++) {
      const counts = new Map<number, number[]>();
      for (let r = 0; r < 9; r++)
        if (current[r][c] === 0) {
          const cand = candidatesForCell(current, r, c);
          for (const n of cand) {
            const arr = counts.get(n) || [];
            arr.push(r);
            counts.set(n, arr);
          }
        }
      for (const [n, arr] of counts.entries()) {
        if (arr.length === 1)
          return {
            hint: `(${arr[0] + 1}, ${c + 1}) = ${n} — hidden single in column ${c + 1}.`,
            row: arr[0],
            col: c,
            value: n,
          };
      }
    }

    // check boxes
    for (let br = 0; br < 3; br++)
      for (let bc = 0; bc < 3; bc++) {
        const counts = new Map<number, [number, number][]>();
        for (let r = br * 3; r < br * 3 + 3; r++)
          for (let c = bc * 3; c < bc * 3 + 3; c++)
            if (current[r][c] === 0) {
              const cand = candidatesForCell(current, r, c);
              for (const n of cand) {
                const arr = counts.get(n) || [];
                arr.push([r, c]);
                counts.set(n, arr);
              }
            }
        for (const [n, arr] of counts.entries()) {
          if (arr.length === 1) {
            const [r, c] = arr[0];
            return {
              hint: `(${r + 1}, ${c + 1}) = ${n} — hidden single in box ${br * 3 + bc + 1}.`,
              row: r,
              col: c,
              value: n,
            };
          }
        }
      }

    return {
      hint: "No simple naked/hidden singles found. Try scanning rows/columns or use the solver.",
    };
  });

export const getStrategy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => strategyInput.parse(d))
  .handler(async ({ data }) => {
    const content = `Start with naked singles and hidden singles, then move to pointing pairs and box-line reductions. Use elimination across rows, columns, and 3x3 boxes. If stuck, try looking for pairs/triples then line/box interactions.`;
    return { strategy: content };
  });

export const scanSudoku = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => scanInput.parse(d))
  .handler(async ({ data }) => {
    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey)
      throw new Error(
        "OCR_SPACE_API_KEY is not set. Add it to your .env file.",
      );

    const base64Payload = data.image.startsWith("data:image/")
      ? data.image
      : `data:image/png;base64,${data.image.replace(/^data:image\/[^;]+;base64,/, "")}`;
    const form = new FormData();
    form.append("apikey", apiKey);
    form.append("base64Image", base64Payload);
    form.append("language", "eng");
    form.append("isTable", "true");
    form.append("OCREngine", "2");
    form.append("scale", "true");
    form.append("detectOrientation", "true");

    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`OCR provider error: ${res.status} ${txt.slice(0, 200)}`);
    }
    const js = await res.json().catch(() => null);
    if (!js || !js.ParsedResults || !js.ParsedResults.length)
      throw new Error("OCR did not return parsable text");

    const parsedText: string = js.ParsedResults[0].ParsedText ?? "";
    const normalized = parsedText
      .replace(/[OQOo〇]/g, "0")
      .replace(/[IlI|!]/g, "1")
      .replace(/[ZzƵ]/g, "2")
      .replace(/[Ss]/g, "5")
      .replace(/[Bb]/g, "8")
      .replace(/[Gg]/g, "6");

    // Try to use TextOverlay words if present
    try {
      const overlay = js.ParsedResults[0].TextOverlay;
      if (overlay && Array.isArray(overlay.Lines) && overlay.Lines.length) {
        const words: {
          text: string;
          left: number;
          top: number;
          width: number;
          height: number;
        }[] = [];
        for (const ln of overlay.Lines) {
          if (!ln || !Array.isArray((ln as Record<string, unknown>).Words))
            continue;
          for (const w of (ln as Record<string, unknown>).Words as unknown[]) {
            const obj = w as Record<string, unknown>;
            const txt = String(obj.WordText || obj.Word || obj.text || "");
            const left = Number(obj.Left ?? obj.left ?? 0);
            const top = Number(obj.Top ?? obj.top ?? 0);
            const width = Number(obj.Width ?? obj.width ?? 0);
            const height = Number(obj.Height ?? obj.height ?? 0);
            words.push({ text: txt, left, top, width, height });
          }
        }

        if (words.length > 0) {
          const centersX = words.map((w) => w.left + w.width / 2);
          const centersY = words.map((w) => w.top + w.height / 2);
          const computePercentile = (arr: number[], p: number) => {
            if (!arr.length) return 0;
            const s = arr.slice().sort((a, b) => a - b);
            const idx = Math.floor((s.length - 1) * p);
            return s[Math.max(0, Math.min(s.length - 1, idx))];
          };
          const minX = computePercentile(centersX, 0.05);
          const maxX = computePercentile(centersX, 0.95);
          const minY = computePercentile(centersY, 0.05);
          const maxY = computePercentile(centersY, 0.95);
          const spanX = Math.max(1e-6, maxX - minX);
          const spanY = Math.max(1e-6, maxY - minY);

          const cells: { digit: number; area: number }[][] = Array.from(
            { length: 9 },
            () => Array(9).fill(null),
          );
          for (const w of words) {
            const cx = w.left + w.width / 2;
            const cy = w.top + w.height / 2;
            let nx = (cx - minX) / spanX;
            let ny = (cy - minY) / spanY;
            nx = Math.max(0, Math.min(0.999999, nx));
            ny = Math.max(0, Math.min(0.999999, ny));
            const centers = Array.from({ length: 9 }, (_, i) => (i + 0.5) / 9);
            let col = 0;
            let bestCx = Infinity;
            for (let j = 0; j < 9; j++) {
              const d = Math.abs(nx - centers[j]);
              if (d < bestCx) {
                bestCx = d;
                col = j;
              }
            }
            let row = 0;
            let bestCy = Infinity;
            for (let j = 0; j < 9; j++) {
              const d = Math.abs(ny - centers[j]);
              if (d < bestCy) {
                bestCy = d;
                row = j;
              }
            }
            const digitMatch = (String(w.text).match(/[0-9]/g) || [])[0];
            if (!digitMatch) continue;
            const area = (w.width || 1) * (w.height || 1);
            const existing = cells[row][col];
            if (!existing || area > existing.area)
              cells[row][col] = { digit: Number(digitMatch), area };
          }

          const byPos = Array.from({ length: 9 }, () => Array(9).fill(0));
          for (let r = 0; r < 9; r++)
            for (let c = 0; c < 9; c++)
              if (cells[r][c]) byPos[r][c] = cells[r][c].digit;

          for (let c = 0; c < 9; c++) {
            const seen = new Map<number, { r: number; area: number }[]>();
            for (let r = 0; r < 9; r++) {
              const d = byPos[r][c];
              if (!d) continue;
              const meta = cells[r][c];
              const arr = seen.get(d) || [];
              arr.push({ r, area: meta ? meta.area : 0 });
              seen.set(d, arr);
            }
            for (const [d, arr] of seen.entries()) {
              if (arr.length <= 1) continue;
              arr.sort((a, b) => b.area - a.area);
              for (let i = 1; i < arr.length; i++) byPos[arr[i].r][c] = 0;
            }
          }

          const placed = byPos.flat().filter(Boolean).length;
          if (placed >= 10) return { grid: byPos }; // Do not mark scannedLoaded here; mark only after user confirms load in UI.
        }
      }
    } catch (e) {
      // fallback to text parsing below
    }

    // fallback strategies: all digits, line parsing, tokens
    const allDigits = (normalized.match(/[0-9]/g) || []).map((d) => Number(d));
    if (allDigits.length >= 81) {
      const first81 = allDigits.slice(0, 81);
      const grid: number[][] = [];
      for (let r = 0; r < 9; r++) grid.push(first81.slice(r * 9, r * 9 + 9));
      return { grid };
    }

    const lines = normalized
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const grid: number[][] = [];
    for (const ln of lines) {
      const digits = ln.match(/[0-9]/g) || [];
      if (digits.length === 0) continue;
      const row = digits.map((d) => Number(d)).slice(0, 9);
      while (row.length < 9) row.push(0);
      grid.push(row as number[]);
      if (grid.length === 9) break;
    }
    if (grid.length === 9) return { grid };

    const tokens = normalized
      .replace(/[^0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length >= 9) {
      const rows: number[][] = [];
      let curRow: number[] = [];
      for (const t of tokens) {
        for (const ch of t) {
          curRow.push(Number(ch));
          if (curRow.length === 9) {
            rows.push(curRow);
            curRow = [];
            if (rows.length === 9) break;
          }
        }
        if (rows.length === 9) break;
      }
      if (rows.length === 9) return { grid: rows };
    }

    throw new Error(
      "Could not reliably parse a 9x9 Sudoku from the image. Try a clearer photo or set OCR_SPACE_API_KEY.",
    );
  });
