import type { ReactNode } from "react";

type CardProps = {
  /** Rendered as the small uppercase heading above the body. */
  title?: string;
  children: ReactNode;
  /** Quiet line under the body, for caveats and links. */
  footer?: ReactNode;
  className?: string;
};

/** Panel surface: card background, hairline border, 14px radius. */
export default function Card({ title, children, footer, className }: CardProps) {
  return (
    <section className={className ? `card ${className}` : "card"}>
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
      {footer ? <div className="card-foot">{footer}</div> : null}
    </section>
  );
}
