/**
 * Label/value row for a card body.
 *
 * Single responsibility: render one `span`/`strong` pair with the `.row`
 * separator styling, so card bodies stop hand-writing the same wrapper.
 *
 * Consumers: PortfolioPage (balances), NetworkPage (backend status), and
 * AllowanceCard (current allowance). `Metric` remains separate because it
 * renders the bordered grid cell used by the Shield report, not a list row.
 */
import type { ReactNode } from "react";

type ValueRowProps = {
  label: string;
  children: ReactNode;
};

export default function ValueRow({ label, children }: ValueRowProps) {
  return (
    <div className="row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}
