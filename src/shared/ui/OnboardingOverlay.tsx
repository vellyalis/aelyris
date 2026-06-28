import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import styles from "./OnboardingOverlay.module.css";

const STORAGE_KEY = "aether:onboarding-done";

interface Step {
  title: string;
  description: string;
  shortcut?: string;
  position: "center" | "left" | "right" | "bottom";
}

const STEPS: Step[] = [
  {
    title: "Welcome to Aether Terminal",
    description: "An AI-native workspace for developers on Windows. Here's a quick tour.",
    position: "center",
  },
  {
    title: "File Explorer",
    description: "Browse and manage your project files. Right-click for actions.",
    position: "left",
  },
  {
    title: "Agent Sessions",
    description: "Start AI agents to help with coding tasks. Each session runs independently.",
    shortcut: "Ctrl+Shift+A",
    position: "right",
  },
  {
    title: "Command Palette",
    description: "Quick access to every action. Search commands by name.",
    shortcut: "Ctrl+Shift+P",
    position: "center",
  },
  {
    title: "Toolkit",
    description: "One-click shortcuts for common operations. Right-click to customize.",
    position: "right",
  },
  {
    title: "You're all set!",
    description: "Explore, build, and ship. Aether is your workspace.",
    position: "center",
  },
];

export function OnboardingOverlay() {
  const [step, setStep] = useState(-1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setStep(0);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const markDoneAndClose = () => {
    setStep(-1);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      /* ignore */
    }
  };

  const handleNext = () => {
    if (step >= STEPS.length - 1) {
      markDoneAndClose();
    } else {
      setStep(step + 1);
    }
  };

  const isOpen = step >= 0;
  const current = isOpen ? STEPS[step] : null;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) markDoneAndClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.contentWrapper} aria-describedby={undefined}>
          <AnimatePresence mode="wait" initial={!reduceMotion}>
            {current && (
              <motion.div
                key={step}
                className={`${styles.card} ${styles[current.position]}`}
                initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 350, damping: 25 }}
              >
                <div className={styles.stepIndicator}>
                  {STEPS.map((item, i) => (
                    <div
                      key={item.title}
                      className={`${styles.dot} ${i === step ? styles.dotActive : ""} ${i < step ? styles.dotDone : ""}`}
                    />
                  ))}
                </div>
                <Dialog.Title className={styles.title}>{current.title}</Dialog.Title>
                <Dialog.Description className={styles.description}>{current.description}</Dialog.Description>
                {current.shortcut && <kbd className={styles.shortcut}>{current.shortcut}</kbd>}
                <div className={styles.actions}>
                  {!isLast && (
                    <button type="button" className={styles.skipBtn} onClick={markDoneAndClose}>
                      Skip tour
                    </button>
                  )}
                  <button type="button" className={styles.nextBtn} onClick={handleNext}>
                    {isLast ? "Get started" : "Next"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
