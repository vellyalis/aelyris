import * as RadixToast from "@radix-ui/react-toast";
import { type ToastItem, useToastStore } from "../store/toastStore";
import styles from "./Toast.module.css";

export function toastSeverityType(type: ToastItem["type"]): "foreground" | "background" {
  // Keep severity mapped to Radix announcement priority in one typed contract.
  return type === "error" ? "foreground" : "background";
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, dismiss } = useToastStore();

  return (
    <RadixToast.Provider swipeDirection="right" duration={4000}>
      {children}
      {toasts.map((t: ToastItem) => (
        <RadixToast.Root
          key={t.id}
          className={`${styles.root} ${styles[t.type]}`}
          open
          type={toastSeverityType(t.type)}
          role={t.type === "error" ? "alert" : "status"}
          aria-live={t.type === "error" ? "assertive" : "polite"}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <RadixToast.Title className={styles.title}>{t.title}</RadixToast.Title>
          {t.description && (
            <RadixToast.Description className={styles.description}>{t.description}</RadixToast.Description>
          )}
          {t.action && (
            <RadixToast.Action
              className={styles.action}
              altText={t.action.label}
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </RadixToast.Action>
          )}
          <RadixToast.Close className={styles.close} aria-label="Dismiss">
            ×
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className={styles.viewport} />
    </RadixToast.Provider>
  );
}
