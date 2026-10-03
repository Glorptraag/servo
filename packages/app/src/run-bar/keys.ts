// Space is Run and Stop (brief Section 10, D42), wherever focus is, except where Space is typing or ticking: a field
// the child types in (the build's name, task 4.9), a select, a checkbox or radio button, or editable text. On a button
// it never activates the button as well, as the canvas's list view already keeps it (packages/canvas, list-view/dom.ts):
// Enter does that. Enter also flips a selected switch during a Run (D42), which is the canvas's.

/** Input types where Space does not type or tick. */
const PRESSED_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'range', 'color', 'file']);

/** True when Space typed into or ticked `target`, so it is not Run and Stop. */
export const spaceBelongsTo = (target: EventTarget | null): boolean => {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;
  return !PRESSED_INPUTS.has((target.getAttribute('type') ?? 'text').toLowerCase());
};

/** True for a press of Space meant as Run and Stop. */
export const isRunKey = (event: KeyboardEvent): boolean =>
  event.key === ' ' &&
  !event.defaultPrevented &&
  !event.isComposing &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  !spaceBelongsTo(event.target);
