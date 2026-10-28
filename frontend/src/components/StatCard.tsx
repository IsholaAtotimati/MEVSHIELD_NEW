import type { ReactNode } from "react";

/**
 * One figure in a row of summary cards: a muted label above a bold tabular
 * value. `gain` colours the value mint and `loss` colours it bad; both are
 * only used when the number itself is unambiguously good or bad, never as
 * decoration.
 */
export type StatTone = "neutral" | "gain" | "loss";

type StatCardProps = {
  label: string;
  value: ReactNode;
  tone?: StatTone;
};

export default function StatCard({ label, value, tone = "neutral" }: StatCardProps) {
  const toneClass = tone === "neutral" ? "" : ` ${tone}`;

  return (
    <div className={`stat${toneClass}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** Row wrapper so pages do not repeat the grid class. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="stats">{children}</div>;
}
