"use client";

import { useState, useRef, useCallback } from "react";

/**
 * A hook to manage the auto-hiding logic of the Bottom Navbar
 * @param threshold - Pixels to scroll before triggering a change (prevents flickering)
 * @param offset - Initial scroll distance required before hiding starts
 */
export function useScrollNavbar(threshold = 10, offset = 50) {
  const [hideNavbar, setHideNavbar] = useState(false);
  const lastScrollY = useRef(0);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      const currentScrollY = e.currentTarget.scrollTop;

      // 1. Ignore very small movements (jitter)
      if (Math.abs(currentScrollY - lastScrollY.current) < threshold) return;

      // 2. Logic: Hide if scrolling down and past offset; show if scrolling up
      if (currentScrollY > lastScrollY.current && currentScrollY > offset) {
        setHideNavbar(true);
      } else {
        setHideNavbar(false);
      }

      lastScrollY.current = currentScrollY;
    },
    [threshold, offset]
  );

  return { hideNavbar, handleScroll };
}
