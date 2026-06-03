import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Board,
  boardsEqual,
  cloneBoard,
  generatePuzzle,
  isValid,
  solve,
} from "@/lib/sudoku";
import { getHint, getStrategy, scanSudoku } from "@/lib/sudoku-ai.functions";
import { toast } from "sonner";
import {
  Lightbulb,
  Wand2,
  RotateCcw,
  Eraser,
  Trophy,
  Timer as TimerIcon,
  XCircle,
  Sparkles,
  Loader2,
  Upload,
} from "lucide-react";

type Difficulty = "easy" | "medium" | "hard";

const MAX_HINTS = 3;
const MAX_MISTAKES = 5;

function emptyBoard(): Board {
  return Array.from({ length: 9 }, () => Array(9).fill(0));
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}

export function SudokuGame() {
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [puzzle, setPuzzle] = useState<Board>(emptyBoard);
  const [solution, setSolution] = useState<Board>(emptyBoard);
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [selected, setSelected] = useState<[number, number]>([0, 0]);
  const [mistakes, setMistakes] = useState(0);
  const [hintsLeft, setHintsLeft] = useState(MAX_HINTS);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [won, setWon] = useState(false);
  const [aiText, setAiText] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [solvedCells, setSolvedCells] = useState<Set<string>>(new Set());
  const [errorCells, setErrorCells] = useState<Set<string>>(new Set());
  const [shakingCell, setShakingCell] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hintFn = useServerFn(getHint);
  const strategyFn = useServerFn(getStrategy);
  const scanFn = useServerFn(scanSudoku);

  const newGame = useCallback((d: Difficulty = difficulty) => {
    const { puzzle: p, solution: s } = generatePuzzle(d);
    setPuzzle(p);
    setSolution(s);
    setBoard(cloneBoard(p));
    setMistakes(0);
    setHintsLeft(MAX_HINTS);
    setSeconds(0);
    setRunning(true);
    setWon(false);
    setAiText("");
    setSolvedCells(new Set());
    setErrorCells(new Set());
    setSelected([0, 0]);
  }, [difficulty]);

  useEffect(() => { newGame("medium"); /* eslint-disable-next-line */ }, []);

  // Timer
  useEffect(() => {
    if (!running || won) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running, won]);

  // Win detection
  useEffect(() => {
    if (!solution.length || won) return;
    if (boardsEqual(board, solution)) {
      setWon(true);
      setRunning(false);
      toast.success("Solved! 🎉", { description: `Time ${fmtTime(seconds)} · ${mistakes} mistakes` });
    }
  }, [board, solution, won, seconds, mistakes]);

  const isFixed = (r: number, c: number) => puzzle[r][c] !== 0;

  const setCellValue = useCallback(
    (r: number, c: number, n: number) => {
      if (isFixed(r, c) || won || solving) return;
      const key = `${r},${c}`;
      if (n === 0) {
        setBoard((b) => {
          const nb = cloneBoard(b);
          nb[r][c] = 0;
          return nb;
        });
        setErrorCells((s) => {
          const ns = new Set(s);
          ns.delete(key);
          return ns;
        });
        return;
      }
      if (solution[r][c] !== n) {
        setMistakes((m) => {
          const nm = m + 1;
          if (nm >= MAX_MISTAKES) {
            toast.error("Game over", { description: "Too many mistakes." });
            setRunning(false);
          }
          return nm;
        });
        setErrorCells((s) => new Set(s).add(key));
        setShakingCell(key);
        setTimeout(() => setShakingCell(null), 300);
      } else {
        setErrorCells((s) => {
          const ns = new Set(s);
          ns.delete(key);
          return ns;
        });
      }
      setBoard((b) => {
        const nb = cloneBoard(b);
        nb[r][c] = n;
        return nb;
      });
    },
    [puzzle, solution, won, solving],
  );

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (solving) return;
      let [r, c] = selected;
      if (e.key === "ArrowUp") { r = Math.max(0, r - 1); setSelected([r, c]); e.preventDefault(); }
      else if (e.key === "ArrowDown") { r = Math.min(8, r + 1); setSelected([r, c]); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { c = Math.max(0, c - 1); setSelected([r, c]); e.preventDefault(); }
      else if (e.key === "ArrowRight") { c = Math.min(8, c + 1); setSelected([r, c]); e.preventDefault(); }
      else if (/^[1-9]$/.test(e.key)) { setCellValue(r, c, parseInt(e.key)); }
      else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { setCellValue(r, c, 0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, setCellValue, solving]);

  const handleHint = async () => {
    if (hintsLeft <= 0) return toast.warning("No hints left");
    setAiLoading(true);
    try {
      const { hint } = await hintFn({ data: { puzzle, current: board } });
      setAiText(hint);
      setHintsLeft((h) => h - 1);
    } catch (e: any) {
      toast.error(e.message ?? "Hint failed");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAISolve = async () => {
    if (solving || won) return;
    setSolving(true);
    setRunning(false);
    // request strategy in parallel
    strategyFn({ data: { puzzle } })
      .then(({ strategy }) => setAiText(strategy))
      .catch(() => {});

    // animate fill
    const target = cloneBoard(puzzle);
    if (!solve(target)) {
      toast.error("Solver failed");
      setSolving(false);
      return;
    }
    const cells: Array<[number, number]> = [];
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) if (board[r][c] !== target[r][c]) cells.push([r, c]);

    for (const [r, c] of cells) {
      await new Promise((res) => setTimeout(res, 60));
      setBoard((b) => {
        const nb = cloneBoard(b);
        nb[r][c] = target[r][c];
        return nb;
      });
      setSolvedCells((s) => new Set(s).add(`${r},${c}`));
      setErrorCells((s) => {
        const ns = new Set(s);
        ns.delete(`${r},${c}`);
        return ns;
      });
    }
    setSolving(false);
  };

  const loadScannedPuzzle = useCallback((grid: Board): string | null => {
    // Returns null on success or an error string on failure
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = grid[r][c];
        if (v !== 0) {
          grid[r][c] = 0;
          if (!isValid(grid, r, c, v)) {
            grid[r][c] = v;
            return `Conflict at row ${r + 1}, column ${c + 1} (digit ${v}). Edit that cell to continue.`;
          }
          grid[r][c] = v;
        }
      }
    }
    const sol = cloneBoard(grid);
    if (!solve(sol)) return "This puzzle has no solution. Check the digits.";
    setPuzzle(cloneBoard(grid));
    setSolution(sol);
    setBoard(cloneBoard(grid));
    setMistakes(0);
    setHintsLeft(MAX_HINTS);
    setSeconds(0);
    setRunning(true);
    setWon(false);
    setAiText("");
    setSolvedCells(new Set());
    setErrorCells(new Set());
    setSelected([0, 0]);
    return null;
  }, []);

  const [reviewGrid, setReviewGrid] = useState<Board | null>(null);

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image is too large (max 10MB)");
      return;
    }
    setScanning(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const { grid } = await scanFn({ data: { image: dataUrl } });
      setReviewGrid(grid);
    } catch (e: any) {
      toast.error(e.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };



  const progress = useMemo(() => {
    let filled = 0, total = 0;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        if (!isFixed(r, c)) {
          total++;
          if (board[r][c] !== 0 && board[r][c] === solution[r][c]) filled++;
        }
      }
    return total === 0 ? 0 : (filled / total) * 100;
  }, [board, puzzle, solution]);

  const [selRow, selCol] = selected;
  const selectedValue = board[selRow]?.[selCol] ?? 0;

  return (
    <div className="min-h-screen w-full px-4 py-8 md:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
              SUDOKU<span className="text-primary">.</span>AI
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Backtracking solver · Lovable AI hints · Pure logic.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => { setDifficulty(d); newGame(d); }}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors ${
                  difficulty === d
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/50"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
          {/* Board */}
          <div className="flex flex-col items-center gap-4">
            <SudokuGrid
              board={board}
              puzzle={puzzle}
              selected={selected}
              setSelected={setSelected}
              errorCells={errorCells}
              solvedCells={solvedCells}
              shakingCell={shakingCell}
              selectedValue={selectedValue}
            />
            <NumberPad
              onPick={(n) => setCellValue(selRow, selCol, n)}
              onErase={() => setCellValue(selRow, selCol, 0)}
              board={board}
            />
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">
            <Stats seconds={seconds} mistakes={mistakes} hintsLeft={hintsLeft} progress={progress} />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <ActionBtn icon={<Lightbulb size={16} />} onClick={handleHint} disabled={aiLoading || hintsLeft <= 0 || won}>
                {aiLoading ? <Loader2 className="animate-spin" size={16} /> : `Hint (${hintsLeft})`}
              </ActionBtn>
              <ActionBtn icon={<Wand2 size={16} />} onClick={handleAISolve} disabled={solving || won} variant="primary">
                {solving ? "Solving…" : "AI Solve"}
              </ActionBtn>
              <ActionBtn
                icon={scanning ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning || solving}
                variant="primary"
              >
                {scanning ? "Scanning…" : "Scan Image"}
              </ActionBtn>
              <ActionBtn icon={<RotateCcw size={16} />} onClick={() => newGame()}>
                New
              </ActionBtn>
              <ActionBtn
                icon={<Eraser size={16} />}
                onClick={() => { setBoard(cloneBoard(puzzle)); setErrorCells(new Set()); setSolvedCells(new Set()); setRunning(true); setWon(false); }}
                disabled={won}
              >
                Reset
              </ActionBtn>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageFile(f);
                e.target.value = "";
              }}
            />


            <AIPanel text={aiText} loading={aiLoading} />

            {won && (
              <div className="rounded-xl border border-success/50 bg-success/10 p-5 text-center">
                <Trophy className="mx-auto mb-2 text-success" />
                <p className="font-display text-xl font-bold text-success">Puzzle solved</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {fmtTime(seconds)} · {mistakes} mistakes
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Arrow keys to navigate · 1–9 to enter · Backspace to clear · Scan an image to load a real puzzle
            </p>
          </div>
        </div>
      </div>

      {reviewGrid && (
        <ReviewScannedModal
          initial={reviewGrid}
          onCancel={() => setReviewGrid(null)}
          onConfirm={(g) => {
            const err = loadScannedPuzzle(g);
            if (err) return err;
            setReviewGrid(null);
            toast.success("Puzzle loaded!", { description: "Hit AI Solve or play it yourself." });
            return null;
          }}
        />
      )}
    </div>
  );
}


function SudokuGrid({
  board, puzzle, selected, setSelected, errorCells, solvedCells, shakingCell, selectedValue,
}: {
  board: Board; puzzle: Board; selected: [number, number];
  setSelected: (s: [number, number]) => void;
  errorCells: Set<string>; solvedCells: Set<string>; shakingCell: string | null;
  selectedValue: number;
}) {
  const [selRow, selCol] = selected;
  return (
    <div className="rounded-2xl border-2 border-grid-strong bg-card p-2 shadow-2xl shadow-primary/20">
      <div className="grid grid-cols-9 gap-0">
        {board.map((row, r) =>
          row.map((val, c) => {
            const key = `${r},${c}`;
            const fixed = puzzle[r][c] !== 0;
            const isSel = r === selRow && c === selCol;
            const inSameLine = r === selRow || c === selCol;
            const inSameBox =
              Math.floor(r / 3) === Math.floor(selRow / 3) &&
              Math.floor(c / 3) === Math.floor(selCol / 3);
            const sameNum = val !== 0 && val === selectedValue;
            const isError = errorCells.has(key);
            const isSolved = solvedCells.has(key);
            const shaking = shakingCell === key;

            const borderR = (c + 1) % 3 === 0 && c !== 8 ? "border-r-2 border-r-grid-strong" : "border-r border-r-grid/40";
            const borderB = (r + 1) % 3 === 0 && r !== 8 ? "border-b-2 border-b-grid-strong" : "border-b border-b-grid/40";
            const borderL = c === 0 ? "" : "";
            const borderT = r === 0 ? "" : "";

            let bg = "";
            if (isSel) bg = "bg-cell-selected";
            else if (sameNum) bg = "bg-cell-same";
            else if (inSameLine || inSameBox) bg = "bg-cell-highlight";

            return (
              <button
                key={key}
                onClick={() => setSelected([r, c])}
                className={[
                  "relative flex aspect-square w-10 items-center justify-center font-display text-xl font-semibold transition-colors md:w-12 md:text-2xl",
                  borderR, borderB, borderL, borderT, bg,
                  fixed ? "text-cell-fixed" : "text-cell-user",
                  isError ? "text-destructive" : "",
                  isSolved ? "animate-solve" : "",
                  shaking ? "animate-shake" : "",
                ].join(" ")}
              >
                {val !== 0 ? val : ""}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}

function NumberPad({
  onPick, onErase, board,
}: { onPick: (n: number) => void; onErase: () => void; board: Board }) {
  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (let r = 0; r < 9; r++) for (let cc = 0; cc < 9; cc++) {
      const v = board[r][cc];
      if (v) c[v] = (c[v] ?? 0) + 1;
    }
    return c;
  }, [board]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
        const done = (counts[n] ?? 0) >= 9;
        return (
          <button
            key={n}
            onClick={() => onPick(n)}
            disabled={done}
            className={`h-11 w-11 rounded-lg border font-display text-xl font-bold transition-all md:h-12 md:w-12 ${
              done
                ? "border-border bg-muted/30 text-muted-foreground/40"
                : "border-primary/40 bg-card text-foreground hover:border-primary hover:bg-primary/10 hover:scale-105"
            }`}
          >
            {n}
          </button>
        );
      })}
      <button
        onClick={onErase}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-destructive/40 bg-card text-destructive hover:bg-destructive/10 md:h-12 md:w-12"
      >
        <Eraser size={18} />
      </button>
    </div>
  );
}

function Stats({
  seconds, mistakes, hintsLeft, progress,
}: { seconds: number; mistakes: number; hintsLeft: number; progress: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-3 gap-4">
        <Stat icon={<TimerIcon size={14} />} label="Time" value={fmtTime(seconds)} />
        <Stat
          icon={<XCircle size={14} />}
          label="Mistakes"
          value={`${mistakes}/${MAX_MISTAKES}`}
          danger={mistakes >= MAX_MISTAKES - 1}
        />
        <Stat icon={<Lightbulb size={14} />} label="Hints" value={`${hintsLeft}`} />
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-bold ${danger ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function ActionBtn({
  children, onClick, disabled, icon, variant = "default",
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean;
  icon: React.ReactNode; variant?: "default" | "primary";
}) {
  const base =
    "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const v =
    variant === "primary"
      ? "border-primary bg-gradient-to-br from-primary to-accent text-primary-foreground hover:opacity-90"
      : "border-border bg-card hover:border-primary/50 hover:bg-primary/5";
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${v}`}>
      {icon}
      {children}
    </button>
  );
}

function AIPanel({ text, loading }: { text: string; loading: boolean }) {
  if (!text && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-5 text-center text-sm text-muted-foreground">
        <Sparkles className="mx-auto mb-2 opacity-60" size={18} />
        Ask for a hint to get an AI-generated logical explanation.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-accent/40 bg-gradient-to-br from-accent/10 to-primary/5 p-5">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
        <Sparkles size={14} /> AI Insight
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" size={14} /> Thinking…
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</p>
      )}
    </div>
  );
}

function ReviewScannedModal({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: Board;
  onCancel: () => void;
  onConfirm: (g: Board) => string | null;
}) {
  const [grid, setGrid] = useState<Board>(() => cloneBoard(initial));
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const [solving, setSolving] = useState(false);

  // Detect duplicates for visual feedback
  const conflicts = useMemo(() => {
    const set = new Set<string>();
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        // row
        for (let cc = 0; cc < 9; cc++) if (cc !== c && grid[r][cc] === v) set.add(`${r},${c}`);
        // col
        for (let rr = 0; rr < 9; rr++) if (rr !== r && grid[rr][c] === v) set.add(`${r},${c}`);
        // box
        const br = Math.floor(r / 3) * 3;
        const bc = Math.floor(c / 3) * 3;
        for (let rr = br; rr < br + 3; rr++)
          for (let cc = bc; cc < bc + 3; cc++)
            if ((rr !== r || cc !== c) && grid[rr][cc] === v) set.add(`${r},${c}`);
      }
    }
    return set;
  }, [grid]);

  const setCell = (r: number, c: number, v: number) => {
    setError(null);
    setGrid((g) => {
      const nb = cloneBoard(g);
      nb[r][c] = v;
      return nb;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      let [r, c] = sel;
      if (e.key === "ArrowUp") { setSel([Math.max(0, r - 1), c]); e.preventDefault(); }
      else if (e.key === "ArrowDown") { setSel([Math.min(8, r + 1), c]); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { setSel([r, Math.max(0, c - 1)]); e.preventDefault(); }
      else if (e.key === "ArrowRight") { setSel([r, Math.min(8, c + 1)]); e.preventDefault(); }
      else if (/^[1-9]$/.test(e.key)) setCell(r, c, parseInt(e.key));
      else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") setCell(r, c, 0);
      else if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]); // eslint-disable-line

  const handleConfirm = () => {
    setSolving(true);
    const err = onConfirm(cloneBoard(grid));
    if (err) setError(err);
    setSolving(false);
  };

  const handleClear = () => {
    setGrid(Array.from({ length: 9 }, () => Array(9).fill(0)));
    setError(null);
  };

  const [selR, selC] = sel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={onCancel}
    >
      <div
        className="relative max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Review scanned puzzle</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              OCR isn't perfect. Tap any cell and type 1–9 to fix mistakes. Red = duplicate.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mx-auto w-fit rounded-xl border-2 border-grid-strong bg-background p-1.5">
          <div className="grid grid-cols-9 gap-0">
            {grid.map((row, r) =>
              row.map((v, c) => {
                const key = `${r},${c}`;
                const isSel = r === selR && c === selC;
                const isConflict = conflicts.has(key);
                const borderR = (c + 1) % 3 === 0 && c !== 8 ? "border-r-2 border-r-grid-strong" : "border-r border-r-grid/40";
                const borderB = (r + 1) % 3 === 0 && r !== 8 ? "border-b-2 border-b-grid-strong" : "border-b border-b-grid/40";
                return (
                  <button
                    key={key}
                    onClick={() => setSel([r, c])}
                    className={[
                      "flex aspect-square w-9 items-center justify-center font-display text-lg font-semibold transition-colors md:w-10 md:text-xl",
                      borderR, borderB,
                      isSel ? "bg-cell-selected" : "",
                      isConflict ? "text-destructive" : "text-foreground",
                    ].join(" ")}
                  >
                    {v !== 0 ? v : ""}
                  </button>
                );
              }),
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button
              key={n}
              onClick={() => setCell(selR, selC, n)}
              className="h-9 w-9 rounded-md border border-primary/40 bg-background font-display font-bold hover:bg-primary/10"
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setCell(selR, selC, 0)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-destructive/40 bg-background text-destructive hover:bg-destructive/10"
          >
            <Eraser size={16} />
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            onClick={handleClear}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-primary/50"
          >
            Clear all
          </button>
          <button
            onClick={onCancel}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-primary/50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={solving}
            className="rounded-md border border-primary bg-gradient-to-br from-primary to-accent px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {solving ? "Validating…" : "Use this puzzle"}
          </button>
        </div>
      </div>
    </div>
  );
}
