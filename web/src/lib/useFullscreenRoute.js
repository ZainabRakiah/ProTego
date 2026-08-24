import * as React from "react";

/**
 * Marks the document while a full-viewport route is mounted.
 *
 * Sign-in and live navigation fill the screen and manage their own overflow,
 * so the document itself must not scroll — and the scrollbar gutter reserved
 * for normal pages must not show as an empty strip. See index.css.
 *
 * Reference-counted, so overlapping full-screen routes cannot clear the flag
 * out from under each other.
 */
let mounted = 0;

export function useFullscreenRoute() {
  React.useEffect(() => {
    mounted += 1;
    document.documentElement.setAttribute("data-fullscreen", "");
    return () => {
      mounted -= 1;
      if (mounted <= 0) {
        mounted = 0;
        document.documentElement.removeAttribute("data-fullscreen");
      }
    };
  }, []);
}
