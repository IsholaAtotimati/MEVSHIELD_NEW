import type { ReactNode } from "react";

/**
 * The solid comparison block: mint for the protected outcome, bad for the
 * public one. Text on mint is #06281A and on bad is #2A0A0A, both set in the
 * stylesheet, so the block keeps its contrast without per-page colours.
 */
type DeltaProps = {
  direction: "gain" | "loss";
  label: string;
  value: ReactNode;
};

export default function Delta({ direction, label, value }: DeltaProps) {
  return (
    <div className={`delta ${direction}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
