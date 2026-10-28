import type { ButtonHTMLAttributes } from "react";

/**
 * The three button treatments from the mockups, plus the pill chip used for
 * presets and filters. Primary is mint with dark text; ghost is transparent
 * with a hairline border; text is a quiet inline action.
 *
 * Disabled styling lives in the shared stylesheet (opacity 0.45) so every
 * button dims the same way.
 */
export type ButtonVariant = "primary" | "ghost" | "text" | "chip";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn btn--primary",
  ghost: "btn btn--ghost",
  text: "btn btn--text",
  chip: "btn btn--chip",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Stretch to the width of the column. */
  wide?: boolean;
  /** Chip only: mint treatment for the currently selected option. */
  selected?: boolean;
};

export default function Button({
  variant = "primary",
  wide = false,
  selected = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    VARIANT_CLASS[variant],
    wide ? "btn--wide" : "",
    selected ? "on" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
