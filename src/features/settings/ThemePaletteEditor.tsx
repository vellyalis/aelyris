import { useCallback, useMemo, useState } from "react";
import { useAppStore } from "../../shared/store/appStore";
import {
  ACCENT_KEYS,
  type AccentKey,
  type AccentOverrides,
  accentLabel,
  applyAccentOverrides,
  getPalette,
  isValidHex,
  normalizeHex,
} from "../../shared/themes/catppuccin";
import styles from "./ThemePaletteEditor.module.css";

interface ThemePaletteEditorProps {
  themeId: string;
  onDirty?: () => void;
}

/**
 * Per-accent editor for the active theme. Color picker writes through to
 * the appStore; the document-level CSS custom properties update on the
 * next commit because `useThemeApplier` watches `themeOverrides`.
 *
 * The edit is "live preview" by definition — the running app *is* the
 * preview surface. There is no preview canvas, only Reset.
 */
export function ThemePaletteEditor({ themeId, onDirty }: ThemePaletteEditorProps) {
  const overrides = useAppStore((s) => s.themeOverrides[themeId]) as AccentOverrides | undefined;
  const setAccentOverride = useAppStore((s) => s.setAccentOverride);
  const resetThemeOverrides = useAppStore((s) => s.resetThemeOverrides);

  const base = useMemo(() => getPalette(themeId), [themeId]);
  const effective = useMemo(() => applyAccentOverrides(base, overrides), [base, overrides]);
  const overriddenCount = overrides ? Object.keys(overrides).length : 0;

  return (
    <div className={styles.editor}>
      <div className={styles.headerRow}>
        <p className={styles.hint}>
          Click an accent to recolor it. Changes apply to the running window — there is no preview canvas.
          Customizations live next to the chosen theme so switching presets keeps them.
        </p>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={() => {
            onDirty?.();
            resetThemeOverrides(themeId);
          }}
          disabled={overriddenCount === 0}
          aria-label="Reset all accents to theme default"
        >
          {overriddenCount === 0 ? "Defaults" : `Reset (${overriddenCount})`}
        </button>
      </div>

      <ul className={styles.grid} aria-label="Theme accents">
        {ACCENT_KEYS.map((key) => (
          <AccentRow
            key={key}
            accentKey={key}
            baseValue={base[key]}
            currentValue={effective[key]}
            isOverridden={Boolean(overrides && key in overrides)}
            onDirty={onDirty}
            onChange={(value) => setAccentOverride(themeId, key, value)}
            onReset={() => setAccentOverride(themeId, key, undefined)}
          />
        ))}
      </ul>
    </div>
  );
}

interface AccentRowProps {
  accentKey: AccentKey;
  baseValue: string;
  currentValue: string;
  isOverridden: boolean;
  onDirty?: () => void;
  onChange: (value: string) => void;
  onReset: () => void;
}

function AccentRow({ accentKey, baseValue, currentValue, isOverridden, onDirty, onChange, onReset }: AccentRowProps) {
  const [draft, setDraft] = useState<string>(currentValue);
  const [invalid, setInvalid] = useState(false);
  const label = accentLabel(accentKey);

  // Keep draft in sync with the store when the user resets or switches theme.
  // We track currentValue in a ref-style guard rather than a useEffect to
  // avoid clobbering an in-progress edit; the input's `key` rerenders us
  // when the prop changes after a reset.
  const lastSeenCurrent = useRefValue(currentValue, () => {
    setDraft(currentValue);
    setInvalid(false);
  });
  void lastSeenCurrent;

  const commit = useCallback(
    (raw: string) => {
      onDirty?.();
      const trimmed = raw.trim();
      if (trimmed === "") return;
      const value = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
      if (!isValidHex(value)) {
        setInvalid(true);
        return;
      }
      const normalized = normalizeHex(value);
      setInvalid(false);
      setDraft(normalized);
      if (normalized.toLowerCase() === baseValue.toLowerCase()) {
        onReset();
      } else {
        onChange(normalized);
      }
    },
    [baseValue, onChange, onDirty, onReset],
  );

  return (
    <li className={styles.row}>
      <label className={styles.swatchLabel} htmlFor={`accent-${accentKey}-color`}>
        <input
          id={`accent-${accentKey}-color`}
          type="color"
          value={normalizeHex(draft)}
          onChange={(e) => {
            onDirty?.();
            const next = e.target.value;
            setDraft(next);
            commit(next);
          }}
          className={styles.colorInput}
          aria-label={`${label} color picker`}
        />
        <span className={styles.swatch} style={{ background: currentValue }} aria-hidden />
      </label>
      <div className={styles.meta}>
        <div className={styles.metaTop}>
          <span className={styles.name}>{label}</span>
          {isOverridden && <span className={styles.overrideBadge}>custom</span>}
        </div>
        <input
          type="text"
          className={styles.hexInput}
          value={draft}
          onChange={(e) => {
            onDirty?.();
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onDirty?.();
              e.preventDefault();
              commit(e.currentTarget.value);
            } else if (e.key === "Escape") {
              onDirty?.();
              setDraft(currentValue);
              setInvalid(false);
            }
          }}
          aria-invalid={invalid || undefined}
          aria-label={`${label} hex value`}
          spellCheck={false}
        />
      </div>
      <button
        type="button"
        className={styles.rowReset}
        onClick={() => {
          onDirty?.();
          onReset();
          setDraft(baseValue);
          setInvalid(false);
        }}
        disabled={!isOverridden}
        aria-label={`Reset ${label} to default`}
        title={`Reset to ${baseValue}`}
      >
        ↺
      </button>
    </li>
  );
}

/**
 * Tracks the last seen `value`. When it changes, runs `onChange`.
 * Implemented via React state to keep the file dependency-free.
 */
function useRefValue<T>(value: T, onChange: () => void): T {
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    onChange();
  }
  return seen;
}
