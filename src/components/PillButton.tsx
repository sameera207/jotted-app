import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; primary?: boolean };

export function PillButton({ icon, primary, children, className, ...rest }: Props) {
  return (
    <button type="button" className={`pill ${primary ? "pill-primary" : ""} ${className ?? ""}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}
