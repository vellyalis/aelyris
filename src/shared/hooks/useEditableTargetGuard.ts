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
  // Also guard against being inside Monaco or the native terminal input
  // surface. Those focus targets often live on inner elements, so walking up a
  // few levels keeps app chrome shortcuts from stealing text input.
  let el: HTMLElement | null = target;
  for (let depth = 0; depth < 4 && el; depth += 1) {
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    if (el.classList.contains("monaco-editor")) return true;
    if (el.getAttribute("role") === "textbox" || el.getAttribute("role") === "searchbox") return true;
    if (el.getAttribute("data-native-input-surface") === "true") return true;
    el = el.parentElement;
  }
  return false;
}
