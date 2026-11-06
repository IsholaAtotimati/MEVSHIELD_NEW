type SwapDirectionButtonProps = {
  routeDirection: string;
  onSwitchDirection: () => void;
};

/** Sits between the pay and receive rows, as the mockup's direction control. */
export default function SwapDirectionButton({
  routeDirection,
  onSwitchDirection,
}: SwapDirectionButtonProps) {
  return (
    <button className="direction" type="button" onClick={onSwitchDirection}>
      Switch direction · {routeDirection}
    </button>
  );
}
