import type { ReactNode } from "react";

/**
 * Label on the left, value on the right, hairline rule underneath.
 *
 * This replaces the earlier `ValueRow`: same idea, and now it can also carry
 * the `gain`/`loss` treatment and a mono value, which is what the Shield
 * report needs. Every existing `ValueRow` call site moved here rather than
 * keeping two near-identical row components.
 */
export type StatLineTone = "neutral" | "gain" | "loss";

type StatLineProps = {
  label: string;
  /** Values that are numbers, amounts, addresses or hashes use mono. */
  mono?: boolean;
  tone?: StatLineTone;
  /** Extra class for the value, e.g. `gain` to colour just the figure. */
  valueClassName?: string;
  children: ReactNode;
};

export default function StatLine({
  label,
  mono = false,
  tone = "neutral",
  valueClassName,
  children,
}: StatLineProps) {
  const toneClass = tone === "neutral" ? "" : ` ${tone}`;
  const valueClasses = [mono ? "mono" : "", valueClassName ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`statline${toneClass}`}>
      <span>{label}</span>
      <b className={valueClasses || undefined}>{children}</b>
    </div>
  );
}
