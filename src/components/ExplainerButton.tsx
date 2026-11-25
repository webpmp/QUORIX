/**
 * Standard "How to use" explainer button component.
 *
 * Usage example:
 * ```tsx
 * <ExplainerButton
 *   label="How do I use the CORR Workspace?"
 *   text="1. Select assets. 2. Choose lookback. 3. Analyze correlation matrix."
 * />
 * ```
 */

import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen } from 'lucide-react';

export interface ExplainerButtonProps {
  label: string;
  text: string | React.ReactNode;
  ariaText?: string;
  maxWidth?: number;
  className?: string;
}

interface TooltipCoords {
  left: number;
  top: number;
  arrowLeft: number;
  placement: 'top' | 'bottom';
  width: number;
}

export const ExplainerButton: React.FC<ExplainerButtonProps> = ({
  label,
  text,
  ariaText,
  maxWidth = 400,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const updatePosition = useCallback(() => {
    const el = btnRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;
    const width = Math.min(maxWidth, Math.max(190, vw - margin * 2));
    const triggerCenterX = rect.left + rect.width / 2;
    const clampedLeft = Math.max(margin, Math.min(triggerCenterX - width / 2, vw - width - margin));
    const arrowLeft = Math.max(12, Math.min(width - 12, triggerCenterX - clampedLeft));

    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const placement: 'top' | 'bottom' =
      spaceBelow < 130 && spaceAbove > spaceBelow ? 'top' : 'bottom';

    const top =
      placement === 'bottom'
        ? rect.bottom + 6
        : rect.top - 6;

    setCoords({
      left: clampedLeft,
      top,
      arrowLeft,
      placement,
      width,
    });
  }, [maxWidth]);

  const openTip = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    updatePosition();
    setIsOpen(true);
  }, [updatePosition]);

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = null;
    }, 120);
  }, []);

  const closeImmediately = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => updatePosition();
    const onScroll = () => updatePosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeImmediately();
      }
    };
    const onOutsideDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (btnRef.current && btnRef.current.contains(target)) return;
      if (tooltipRef.current && tooltipRef.current.contains(target)) return;
      closeImmediately();
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onOutsideDown);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onOutsideDown);
    };
  }, [isOpen, updatePosition, closeImmediately]);

  const defaultButtonClass =
    'p-1.5 rounded bg-[#0c0c0c] border border-[#333] hover:border-[#ff9900] text-zinc-300 hover:text-[#ff9900] focus:text-[#ff9900] focus:border-[#ff9900] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] inline-flex items-center justify-center transition-colors cursor-help shrink-0';

  const tooltipDataText = ariaText || (typeof text === 'string' ? text : label);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        data-tooltip-text={tooltipDataText}
        onMouseEnter={openTip}
        onMouseLeave={scheduleClose}
        onFocus={openTip}
        onBlur={closeImmediately}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            closeImmediately();
          } else {
            openTip();
          }
        }}
        className={className ? `${defaultButtonClass} ${className}`.trim() : defaultButtonClass}
      >
        <BookOpen size={13} aria-hidden="true" />
      </button>

      {isOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            onMouseEnter={openTip}
            onMouseLeave={scheduleClose}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              transform: coords.placement === 'top' ? 'translateY(-100%)' : 'none',
              zIndex: 9999,
            }}
            className="pointer-events-auto rounded bg-[#0a0a0a] border border-[#ff9900]/70 text-zinc-100 text-xs p-2.5 shadow-2xl font-mono animate-fade-in select-text max-h-[85vh] overflow-y-auto"
          >
            {/* Arrow notch */}
            <span
              aria-hidden="true"
              style={{ left: `${coords.arrowLeft}px` }}
              className={`absolute w-2.5 h-2.5 rotate-45 bg-[#0a0a0a] border-[#ff9900]/70 ${
                coords.placement === 'bottom'
                  ? '-top-[5px] border-l border-t'
                  : '-bottom-[5px] border-r border-b'
              }`}
            />
            {typeof text === 'string' ? (
              <div className="leading-relaxed whitespace-pre-wrap">{text}</div>
            ) : (
              text
            )}
          </div>,
          document.body
        )}
    </>
  );
};

export default ExplainerButton;
