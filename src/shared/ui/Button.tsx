import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { RevealHighlight } from "./RevealHighlight";
import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "secondary", size = "md", icon, className, children, ...props }, ref) {
    const sizeClass = size !== "md" ? styles[size] : "";
    const cls = `${styles.btn} ${styles[variant]} ${sizeClass} ${className ?? ""}`.trim();

    return (
      <RevealHighlight borderRadius={4}>
        <button ref={ref} className={cls} {...props}>
          {icon}
          {children}
        </button>
      </RevealHighlight>
    );
  },
);
