import type { ReactNode } from "react";

import { SHIELD_PHASE_TITLE, type ShieldPhase } from "../lib/shieldReport";
import Kicker from "./Kicker";

type ShieldReportProps = {
  phase: ShieldPhase;
  /** Demo caveat or wallet warning, rendered above the phase body. */
  notice?: ReactNode;
  children?: ReactNode;
  /** Quiet closing content, e.g. the lifecycle checklist. */
  footer?: ReactNode;
};

/**
 * The right hand report column, matching the extension panel: kicker, a title
 * that advances with the swap, then the body for the current phase.
 */
export default function ShieldReport({
  phase,
  notice,
  children,
  footer,
}: ShieldReportProps) {
  return (
    <aside className="panel" aria-label="Shield report">
      <Kicker>MEVShield</Kicker>
      <h2 className="panel-title">{SHIELD_PHASE_TITLE[phase]}</h2>
      {notice}
      {children}
      {footer ? <div className="panel-foot">{footer}</div> : null}
    </aside>
  );
}
