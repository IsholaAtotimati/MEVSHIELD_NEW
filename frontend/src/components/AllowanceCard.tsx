import { formatTokenAmount } from "../lib/format";
import Button from "./Button";
import Card from "./Card";
import StatLine from "./StatLine";

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

/**
 * Router allowance for one token: the current figure, an exact-amount field
 * and the two write actions. Behaviour is unchanged; only the surface and the
 * row component moved to the shared kit.
 */
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
    <Card
      title={`Router allowance (${symbol})`}
      footer={`The router pulls ${symbol} only for the amount you approve here. Revoking sets the allowance back to zero.`}
    >
      <StatLine label="Current allowance" mono>
        {formatTokenAmount(allowance, decimals)} {symbol}
      </StatLine>
      <label className="field" htmlFor={inputId}>
        <span>Exact amount to approve in {symbol}</span>
        <input
          className="input"
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
        <Button variant="ghost" disabled={busy} onClick={onApprove}>
          Approve exact amount
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onRevoke}>
          Revoke (zero)
        </Button>
      </div>
    </Card>
  );
}
