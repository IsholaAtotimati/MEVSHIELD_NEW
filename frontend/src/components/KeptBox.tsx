import type { ReactNode } from "react";

type KeptBoxProps = {
  /** Small mint kicker above the figure. */
  label: string;
  /** The one large number. Already formatted, e.g. "0.0056 ETH". */
  value: string;
  /** Optional mono second line under the figure. */
  detail?: ReactNode;
  note?: string;
};

/**
 * The receipt headline: mint tinted box with a single large tabular figure.
 * Only ever used for a value that is genuinely favourable.
 */
export default function KeptBox({ label, value, detail, note }: KeptBoxProps) {
  return (
    <div className="kept">
      <p className="kicker">{label}</p>
      <div className="num">{value}</div>
      {detail ? <div className="mono kept-detail">{detail}</div> : null}
      {note ? <p>{note}</p> : null}
    </div>
  );
}
