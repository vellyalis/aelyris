/**
 * Returns true when the given event target is an editable surface
 * (<input>, <textarea>, contentEditable). Global keyboard shortcuts
 * should bail out in that case so the user's typing is never stolen.
 *
 * Introduced in Wave 2.6 of the 2026-04-24 Liquid Glass audit to fix
 * the "Ctrl+R/N/P/W steals keystrokes while typing in Kanban task
 * label / Watchdog rule / Helm input" class of bug.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // Also guard against being inside a Monaco editor / xterm canvas — their
  // focus lives on inner elements so walking up a few levels is prudent.
  let el: HTMLElement | null = target;
  for (let depth = 0; depth < 4 && el; depth += 1) {
    if (el.classList.contains("monaco-editor") || el.classList.contains("xterm-screen")) return true;
    el = el.parentElement;
  }
  return false;
}
