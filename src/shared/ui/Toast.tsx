import * as RadixToast from "@radix-ui/react-toast";
import { useToastStore, type ToastItem } from "../store/toastStore";
import styles from "./Toast.module.css";

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
          onOpenChange={(open) => { if (!open) dismiss(t.id); }}
        >
          <RadixToast.Title className={styles.title}>{t.title}</RadixToast.Title>
          {t.description && (
            <RadixToast.Description className={styles.description}>{t.description}</RadixToast.Description>
          )}
          <RadixToast.Close className={styles.close} aria-label="Dismiss">×</RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className={styles.viewport} />
    </RadixToast.Provider>
  );
}
