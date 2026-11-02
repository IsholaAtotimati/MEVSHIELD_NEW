import type { ReactNode } from "react";

type RiskCalloutProps = {
  /** Uppercase amber heading, e.g. "Sandwich risk" or "Demo estimate". */
  heading: string;
  children: ReactNode;
};

/** Amber advisory block. Used for risk explanation and for demo caveats. */
export default function RiskCallout({ heading, children }: RiskCalloutProps) {
  return (
    <div className="risk">
      <b>{heading}</b>
      <div className="risk-body">{children}</div>
    </div>
  );
}
