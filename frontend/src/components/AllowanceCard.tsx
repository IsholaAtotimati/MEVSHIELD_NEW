import { formatTokenAmount } from "../lib/format";
import ValueRow from "./ValueRow";

type AllowanceCardProps = {
  symbol: string;
  decimals: number;
  allowance: bigint | null;
  amount: string;
  busy: boolean;
  onAmountChange: (value: string) => void;
  onApprove: () => void;
  onRevoke: () => void;
};

export default function AllowanceCard({
  symbol,
  decimals,
  allowance,
  amount,
  busy,
  onAmountChange,
  onApprove,
  onRevoke,
}: AllowanceCardProps) {
  const inputId = `approve-amount-${symbol.toLowerCase()}`;

  return (
    <div className="card">
      <h2>Router allowance ({symbol})</h2>
      <ValueRow label="Current allowance">
        {formatTokenAmount(allowance, decimals)} {symbol}
      </ValueRow>      <label htmlFor={inputId}>
        Exact amount to approve ({symbol})
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder={`0.0 ${symbol}`}
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button type="button" disabled={busy} onClick={onApprove}>
          Approve exact amount
        </button>
        <button type="button" disabled={busy} onClick={onRevoke}>
          Revoke (zero)
        </button>
      </div>
      <p className="muted">
        The router pulls {symbol} only for the amount you approve here. Revoking
        sets the allowance back to zero.
      </p>
    </div>
  );
}
