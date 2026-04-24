import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
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

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setStep(0);
      }
    } catch { /* ignore */ }
  }, []);

  // Escape exits the tour just like the Skip button — mirrors every other
  // dialog in the app and satisfies the P2.5 a11y requirement without
  // pulling the whole Radix Dialog stack into an onboarding surface.
  useEffect(() => {
    if (step < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStep(-1);
        try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* ignore */ }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const handleNext = () => {
    if (step >= STEPS.length - 1) {
      setStep(-1);
      try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* ignore */ }
    } else {
      setStep(step + 1);
    }
  };

  const handleSkip = () => {
    setStep(-1);
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* ignore */ }
  };

  if (step < 0) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        className={styles.overlay}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          key={step}
          className={`${styles.card} ${styles[current.position]}`}
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: "spring", stiffness: 350, damping: 25 }}
        >
          <div className={styles.stepIndicator}>
            {STEPS.map((_, i) => (
              <div key={i} className={`${styles.dot} ${i === step ? styles.dotActive : ""} ${i < step ? styles.dotDone : ""}`} />
            ))}
          </div>
          <h3 className={styles.title}>{current.title}</h3>
          <p className={styles.description}>{current.description}</p>
          {current.shortcut && (
            <kbd className={styles.shortcut}>{current.shortcut}</kbd>
          )}
          <div className={styles.actions}>
            {!isLast && (
              <button className={styles.skipBtn} onClick={handleSkip}>Skip tour</button>
            )}
            <button className={styles.nextBtn} onClick={handleNext}>
              {isLast ? "Get started" : "Next"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
