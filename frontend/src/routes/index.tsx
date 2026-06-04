import { createFileRoute } from "@tanstack/react-router";
import { SudokuGame } from "../components/SudokuGame";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sudoku.AI — Solve with logic, powered by AI" },
      {
        name: "description",
        content:
          "Play Sudoku with a backtracking solver, AI-powered logical hints, image & camera scanning, timer, and keyboard navigation.",
      },
      { property: "og:title", content: "Sudoku.AI" },
      {
        property: "og:description",
        content:
          "AI-powered Sudoku with logical hints, image scan, and animated solving.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      <SudokuGame />
      <Toaster theme="dark" />
    </>
  );
}
