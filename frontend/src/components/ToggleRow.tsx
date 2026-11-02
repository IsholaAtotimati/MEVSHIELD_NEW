type ToggleRowProps = {
  label: string;
  on: boolean;
  /** Optional trailing text after the label, e.g. a scope note. */
  hint?: string;
  /** Read-only rows render the state without offering a change. */
  disabled?: boolean;
  onToggle?: (next: boolean) => void;
};

/**
 * Full width row: label left, On/Off right. On is mint border and mint text,
 * Off is muted. A disabled row shows the same state without the affordance.
 */
export default function ToggleRow({
  label,
  on,
  hint,
  disabled = false,
  onToggle,
}: ToggleRowProps) {
  const body = (
    <>
      <span>
        {label}
        {hint ? <small className="toggle-hint"> {hint}</small> : null}
      </span>
      <b>{on ? "On" : "Off"}</b>
    </>
  );

  if (disabled || !onToggle) {
    return (
      <div className={`toggle ${on ? "on" : "off"}`} aria-disabled="true">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`toggle ${on ? "on" : "off"}`}
      aria-pressed={on}
      onClick={() => onToggle(!on)}
    >
      {body}
    </button>
  );
}
