import type { ReactNode } from "react";

type PolicyBoxProps = {
  /** Uppercase mint heading. */
  title: string;
  children: ReactNode;
};

/** Card surface with a mint uppercase heading, holding signed policy fields. */
export default function PolicyBox({ title, children }: PolicyBoxProps) {
  return (
    <div className="policy">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
