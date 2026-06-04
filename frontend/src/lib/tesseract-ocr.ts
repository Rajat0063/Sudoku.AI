export async function parseImageToGrid(
  dataUrl: string,
): Promise<{ grid: number[][]; rawText: string }> {
  if (typeof window === "undefined")
    throw new Error("Tesseract runs in browser");
  // dynamic import to avoid SSR issues
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker({ logger: () => {} });
  try {
    await worker.load();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    const { data } = await worker.recognize(dataUrl, {
      tessjs_create_hocr: "0",
      tessjs_create_tsv: "0",
    } as unknown as Record<string, unknown>);
    const words = (data.words || []).map((w: unknown) => {
      const rec = w as Record<string, unknown>;
      const bbox = rec.bbox as Record<string, unknown> | undefined;
      const left = Number(bbox?.x0 ?? bbox?.x ?? rec.x0 ?? rec.Left ?? 0);
      const top = Number(bbox?.y0 ?? bbox?.y ?? rec.y0 ?? rec.Top ?? 0);
      const x1 = Number(
        bbox?.x1 ??
          bbox?.x ??
          rec.x1 ??
          Number(rec.Left ?? 0) + Number(rec.width ?? 0),
      );
      const x0 = Number(bbox?.x0 ?? bbox?.x ?? rec.x0 ?? rec.Left ?? 0);
      const y1 = Number(
        bbox?.y1 ??
          bbox?.y ??
          rec.y1 ??
          Number(rec.Top ?? 0) + Number(rec.height ?? 0),
      );
      const y0 = Number(bbox?.y0 ?? bbox?.y ?? rec.y0 ?? rec.Top ?? 0);
      const width = Number(x1 - x0);
      const height = Number(y1 - y0);
      return {
        text: String(rec.text ?? rec.word ?? rec.WordText ?? ""),
        left,
        top,
        width,
        height,
      };
    });

    const normalized = (data.text || "")
      .replace(/[OQOo〇]/g, "0")
      .replace(/[IlI|!]/g, "1")
      .replace(/[ZzƵ]/g, "2")
      .replace(/[Ss]/g, "5")
      .replace(/[Bb]/g, "8")
      .replace(/[Gg]/g, "6");

    // If positional words exist, map them to 9x9 grid using robust 1D k-means clustering for centers
    if (words.length > 0) {
      const centersX = words.map((w) => w.left + w.width / 2);
      const centersY = words.map((w) => w.top + w.height / 2);

      // Map detected word centers into a 9x9 grid by normalizing positions
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

      // store candidates per cell with confidence (area) so we can resolve collisions
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
        // choose nearest of 9 evenly spaced centers to avoid boundary bias
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
        if (!existing || area > existing.area) {
          cells[row][col] = { digit: Number(digitMatch), area };
        }
      }

      // build numeric grid and remove repeated digits in same column by keeping largest-area instance
      const byPos = Array.from({ length: 9 }, () => Array(9).fill(0));
      // first pass: place best candidate per cell
      for (let r = 0; r < 9; r++)
        for (let c = 0; c < 9; c++)
          if (cells[r][c]) byPos[r][c] = cells[r][c].digit;

      // de-duplicate columns: if same digit appears multiple times in a column, keep the cell with largest area
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
          // keep first, clear others
          for (let i = 1; i < arr.length; i++) byPos[arr[i].r][c] = 0;
        }
      }
      const placed = byPos.flat().filter(Boolean).length;
      if (placed >= 10) {
        // try fill from line text
        const lines = (data.text || "")
          .split(/\r?\n/)
          .map((l: string) => l.trim())
          .filter(Boolean);
        for (let r = 0; r < Math.min(9, lines.length); r++) {
          const digits = (lines[r].match(/[0-9]/g) || []).map(Number);
          let ci = 0;
          for (let c = 0; c < 9 && ci < digits.length; c++) {
            if (!byPos[r][c] || byPos[r][c] === 0) {
              byPos[r][c] = digits[ci++];
            }
          }
        }
        await worker.terminate();
        return { grid: byPos, rawText: data.text || "" };
      }
    }

    // fallback: digit-first extraction
    const allDigits = ((normalized.match(/[0-9]/g) || []) as string[]).map(
      (d) => Number(d),
    );
    if (allDigits.length >= 81) {
      const grid: number[][] = [];
      const first81 = allDigits.slice(0, 81);
      for (let r = 0; r < 9; r++) grid.push(first81.slice(r * 9, r * 9 + 9));
      await worker.terminate();
      return { grid, rawText: data.text || "" };
    }
    const lines = normalized
      .split(/\r?\n/)
      .map((l: string) => l.trim())
      .filter(Boolean);
    const grid: number[][] = [];
    for (const ln of lines) {
      const digits = ln.match(/[0-9]/g) || [];
      if (digits.length === 0) continue;
      const row = digits.map((d: string) => Number(d)).slice(0, 9);
      while (row.length < 9) row.push(0);
      grid.push(row as number[]);
      if (grid.length === 9) break;
    }
    await worker.terminate();
    if (grid.length === 9) return { grid, rawText: data.text || "" };
    throw new Error("Could not parse grid via Tesseract");
  } catch (e) {
    try {
      await worker.terminate();
    } catch (err) {
      void err;
    }
    throw e;
  }
}
