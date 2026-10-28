import type { ReactNode } from "react";

/** One side of the pair. `tone` picks the mint or bad treatment. */
export type MiniPairItem = {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "gain" | "loss";
};

type MiniPairProps = {
  left: MiniPairItem;
  right: MiniPairItem;
};

/**
 * Two small cards side by side. Used where the app has two figures for the
 * same swap and they belong read together, for example the protected output
 * beside the model loss estimate.
 */
export default function MiniPair({ left, right }: MiniPairProps) {
  return (
    <div className="pair">
      <MiniCard item={left} />
      <MiniCard item={right} />
    </div>
  );
}

function MiniCard({ item }: { item: MiniPairItem }) {
  const tone = item.tone && item.tone !== "neutral" ? ` ${item.tone}` : "";

  return (
    <div className={`mini${tone}`}>
      <span>{item.label}</span>
      <b className="mono">{item.value}</b>
    </div>
  );
}
