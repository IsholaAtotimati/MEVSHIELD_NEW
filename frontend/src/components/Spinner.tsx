/** Mint ring spinner, used wherever a request is in flight. */
export default function Spinner({ label }: { label?: string }) {
  if (!label) {
    return <span className="spin" role="status" aria-label="Loading" />;
  }

  return (
    <p className="spinner-row" role="status" aria-live="polite">
      <span className="spin" aria-hidden="true" />
      <span>{label}</span>
    </p>
  );
}
