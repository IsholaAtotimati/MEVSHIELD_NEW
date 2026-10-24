type SwapDirectionButtonProps = {
  routeDirection: string;
  onSwitchDirection: () => void;
};

export default function SwapDirectionButton({
  routeDirection,
  onSwitchDirection,
}: SwapDirectionButtonProps) {
  return (
    <button
      className="swap-direction"
      type="button"
      onClick={onSwitchDirection}
    >
      Switch direction · {routeDirection}
    </button>
  );
}
