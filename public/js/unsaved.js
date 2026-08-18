/* A single place to register "this screen has unsaved input".
 *
 * The balance screen is a lot of hand-typed numbers, and losing them to a
 * stray click on the sidebar is the kind of thing that stops people using an
 * app at all. Views register a predicate; the router and the browser both ask
 * it before the work can disappear.
 */

let isDirty = null;

export function setUnsavedGuard(predicate) {
  isDirty = predicate;
}

export function clearUnsavedGuard() {
  isDirty = null;
}

export function hasUnsavedWork() {
  try {
    return typeof isDirty === 'function' && isDirty() === true;
  } catch {
    return false;
  }
}

// Covers reload, tab close and back-out. The browser shows its own wording;
// all we control is whether it asks at all.
window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedWork()) return;
  event.preventDefault();
  event.returnValue = '';
});
