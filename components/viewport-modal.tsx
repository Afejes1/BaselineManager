"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ViewportModalProps = {
  children: ReactNode;
  onDismiss: () => void;
  labelledBy?: string;
  className?: string;
  dismissDisabled?: boolean;
};

/**
 * A dialog layer mounted directly under document.body.
 *
 * Keeping the backdrop outside page shells prevents a flex, overflow, or
 * stacking context in an individual dashboard from clipping the viewport.
 */
export function ViewportModal({ children, onDismiss, labelledBy, className = "", dismissDisabled = false }: ViewportModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !dismissDisabled) onDismiss();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismissDisabled, onDismiss]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-backdrop viewport-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !dismissDisabled) onDismiss();
      }}
    >
      <section className={`import-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </section>
    </div>,
    document.body,
  );
}
