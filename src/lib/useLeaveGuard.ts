"use client";

import { useEffect, useRef, type RefObject } from "react";

// Leaving a form with changes in it loses them, so the person is asked first.
// "Changes" is the form's own content compared with what it held when it
// opened (or when it was last saved, for a form that stays open after a save).
//
// Two ways out are covered: a link inside the app (asked with confirm, before
// Next's Link handles the click) and closing or reloading the tab (the
// browser's own warning). A download link is not leaving. While the form is
// being saved nothing is asked: the save is the way out.
const QUESTION = "Leave without saving? What you changed here will be lost.";

function contentOf(form: HTMLFormElement): string {
  return JSON.stringify(
    [...new FormData(form)].map(([name, value]) => [
      name,
      typeof value === "string" ? value : value.name,
    ]),
  );
}

/**
 * Asks before the page is left while `content` differs from what it was when
 * this was called. Returns the function that stops asking.
 */
export function guardLeaving(
  content: () => string | null,
  saving: () => boolean,
): () => void {
  const opened = content();
  const changed = () => {
    if (saving()) return false;
    const now = content();
    return now !== null && now !== opened;
  };

  const onUnload = (e: BeforeUnloadEvent) => {
    if (!changed()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // a new tab or window
    const link = (e.target as Element | null)?.closest?.("a[href]");
    if (!link || link.hasAttribute("download")) return;
    if (link.getAttribute("target") === "_blank") return;
    if (changed() && !window.confirm(QUESTION)) e.preventDefault();
  };
  window.addEventListener("beforeunload", onUnload);
  document.addEventListener("click", onClick, true);
  return () => {
    window.removeEventListener("beforeunload", onUnload);
    document.removeEventListener("click", onClick, true);
  };
}

/**
 * The guard for a form. `savedAt` changes when a save went through and the form
 * stays open: what it holds then is the new starting point.
 */
export function useLeaveGuard(
  formRef: RefObject<HTMLFormElement | null>,
  saving: boolean,
  savedAt?: string,
) {
  const savingNow = useRef(saving);
  savingNow.current = saving;

  useEffect(() => {
    if (!formRef.current) return;
    return guardLeaving(
      () => (formRef.current ? contentOf(formRef.current) : null),
      () => savingNow.current,
    );
  }, [formRef, savedAt]);
}
