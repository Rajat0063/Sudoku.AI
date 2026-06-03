export type Board = number[][]; // 0 = empty

export const EMPTY = 0;

export function cloneBoard(b: Board): Board {
  return b.map((r) => r.slice());
}

export function isValid(b: Board, row: number, col: number, num: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (b[row][i] === num) return false;
    if (b[i][col] === num) return false;
  }
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++) {
    for (let c = bc; c < bc + 3; c++) {
      if (b[r][c] === num) return false;
    }
  }
  return true;
}

function findEmpty(b: Board): [number, number] | null {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) if (b[r][c] === EMPTY) return [r, c];
  return null;
}

export function solve(b: Board): boolean {
  const spot = findEmpty(b);
  if (!spot) return true;
  const [r, c] = spot;
  for (let n = 1; n <= 9; n++) {
    if (isValid(b, r, c, n)) {
      b[r][c] = n;
      if (solve(b)) return true;
      b[r][c] = 0;
    }
  }
  return false;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fillBoard(b: Board): boolean {
  const spot = findEmpty(b);
  if (!spot) return true;
  const [r, c] = spot;
  for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (isValid(b, r, c, n)) {
      b[r][c] = n;
      if (fillBoard(b)) return true;
      b[r][c] = 0;
    }
  }
  return false;
}

// Count solutions up to a cap (for uniqueness checks)
function countSolutions(b: Board, cap = 2): number {
  const spot = findEmpty(b);
  if (!spot) return 1;
  const [r, c] = spot;
  let count = 0;
  for (let n = 1; n <= 9; n++) {
    if (isValid(b, r, c, n)) {
      b[r][c] = n;
      count += countSolutions(b, cap - count);
      b[r][c] = 0;
      if (count >= cap) return count;
    }
  }
  return count;
}

export interface Puzzle {
  puzzle: Board;
  solution: Board;
}

export function generatePuzzle(difficulty: "easy" | "medium" | "hard" = "medium"): Puzzle {
  const board: Board = Array.from({ length: 9 }, () => Array(9).fill(0));
  fillBoard(board);
  const solution = cloneBoard(board);

  const removals = { easy: 40, medium: 50, hard: 56 }[difficulty];
  const positions = shuffle(Array.from({ length: 81 }, (_, i) => i));

  let removed = 0;
  for (const pos of positions) {
    if (removed >= removals) break;
    const r = Math.floor(pos / 9);
    const c = pos % 9;
    const backup = board[r][c];
    if (backup === 0) continue;
    board[r][c] = 0;
    const copy = cloneBoard(board);
    if (countSolutions(copy, 2) !== 1) {
      board[r][c] = backup;
    } else {
      removed++;
    }
  }

  return { puzzle: board, solution };
}

export function boardsEqual(a: Board, b: Board): boolean {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) if (a[r][c] !== b[r][c]) return false;
  return true;
}

export function boardToString(b: Board): string {
  return b.map((row) => row.map((v) => (v === 0 ? "." : String(v))).join("")).join("\n");
}
