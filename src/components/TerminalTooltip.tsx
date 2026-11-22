import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export interface TerminalTooltipProps {
  /** Concise tooltip body text or structured JSX content. */
  content: React.ReactNode;
  /** Optional short uppercase header rendered inside the tooltip box. */
  title?: string;
  /** Accessible text stored for screen readers / fallback identification. */
  ariaText?: string;
  /** Preferred maximum tooltip width in pixels (default: 260). */
  maxWidth?: number;
  /** When true, tooltip ignores pointer events (ideal for interactive matrix cells so clicks are never blocked). */
  nonInteractive?: boolean;
  /** Element that triggers the tooltip on hover, focus, or touch/click. */
  children: React.ReactNode;
  className?: string;
}

interface TooltipCoords {
  top: number;
  left: number;
  width: number;
  arrowLeft: number;
  placement: 'top' | 'bottom';
  maxHeight: number;
}

/**
 * Portal-rendered dark-terminal tooltip matching Quorix's InstitutionalActivityScreen pattern.
 * - Opens on hover, keyboard focus, and touch/click toggle (unless trigger handles its own click).
 * - Automatically clamps within the viewport and flips above/below the trigger so it never clips
 *   inside overflow-x-auto tables or covers adjacent chart data unnecessarily.
 */
export const TerminalTooltip: React.FC<TerminalTooltipProps> = ({
  content,
  title,
  ariaText,
  maxWidth = 260,
  nonInteractive = true,
  children,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const tooltipId = useId();

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;
    const width = Math.min(maxWidth, Math.max(180, vw - margin * 2));
    const triggerCenterX = rect.left + rect.width / 2;
    const clampedLeft = Math.max(margin, Math.min(triggerCenterX - width / 2, vw - width - margin));
    const arrowLeft = Math.max(12, Math.min(width - 12, triggerCenterX - clampedLeft));

    // Prefer above the trigger when near bottom of viewport, otherwise below (or above if space allows)
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const placement: 'top' | 'bottom' =
      spaceBelow < 130 && spaceAbove > spaceBelow ? 'top' : 'bottom';
    const top = placement === 'bottom' ? rect.bottom + 7 : rect.top - 7;
    const maxHeight = Math.max(140, (placement === 'bottom' ? spaceBelow : spaceAbove) - 18);

    setCoords({ top, left: clampedLeft, width, arrowLeft, placement, maxHeight });
  }, [maxWidth]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openTip = useCallback(() => {
    cancelClose();
    updatePosition();
    setOpen(true);
  }, [cancelClose, updatePosition]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 90);
  }, [cancelClose]);

  const closeImmediately = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onReposition = () => updatePosition();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, updatePosition]);

  const hasDisplayClass = /(?:^|\s)(?:block|flex|grid|inline-flex)(?:\s|$)/.test(className);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={openTip}
      onMouseLeave={scheduleClose}
      onFocus={openTip}
      onBlur={closeImmediately}
      data-tooltip-text={ariaText || (typeof content === 'string' ? content : title || '')}
      aria-describedby={open ? tooltipId : undefined}
      className={hasDisplayClass ? className : `inline-flex items-center ${className}`.trim()}
    >
      {children}
      {open &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            onMouseEnter={nonInteractive ? undefined : cancelClose}
            onMouseLeave={nonInteractive ? undefined : scheduleClose}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              transform: coords.placement === 'top' ? 'translateY(-100%)' : undefined,
              zIndex: 9999,
            }}
            className={`${
              nonInteractive ? 'pointer-events-none' : ''
            } rounded bg-[#0a0a0a] border border-[#444] shadow-2xl shadow-black/95 px-2.5 py-2 font-mono text-[10.5px] leading-snug text-zinc-200 text-left normal-case tracking-normal font-normal`}
          >
            <span
              aria-hidden="true"
              style={{ left: `${coords.arrowLeft - 4}px` }}
              className={`absolute w-2 h-2 rotate-45 bg-[#0a0a0a] ${
                coords.placement === 'bottom'
                  ? '-top-[5px] border-l border-t border-[#444]'
                  : '-bottom-[5px] border-r border-b border-[#444]'
              }`}
            />
            {title && (
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-[#ff9900] mb-1">
                {title}
              </div>
            )}
            <div className="text-zinc-300">{content}</div>
          </div>,
          document.body
        )}
    </span>
  );
};

export interface InfoTooltipIconProps {
  label: string;
  title?: string;
  content: React.ReactNode;
  ariaText?: string;
  maxWidth?: number;
  size?: number;
  scrollable?: boolean;
  buttonClassName?: string;
}

/**
 * Keyboard-accessible, touch-friendly Info icon trigger for section headings, metric labels, and header help.
 */
export const InfoTooltipIcon: React.FC<InfoTooltipIconProps> = ({
  label,
  title,
  content,
  ariaText,
  maxWidth = 260,
  size = 11,
  scrollable = false,
  buttonClassName,
}) => {
  const [touchOpen, setTouchOpen] = useState(false);
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
    const top = placement === 'bottom' ? rect.bottom + 7 : rect.top - 7;
    const maxHeight = Math.max(160, (placement === 'bottom' ? spaceBelow : spaceAbove) - 18);

    setCoords({ top, left: clampedLeft, width, arrowLeft, placement, maxHeight });
  }, [maxWidth]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openTip = useCallback(() => {
    cancelClose();
    updatePosition();
    setTouchOpen(true);
  }, [cancelClose, updatePosition]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setTouchOpen(false), 110);
  }, [cancelClose]);

  const closeImmediately = useCallback(() => {
    cancelClose();
    setTouchOpen(false);
  }, [cancelClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!touchOpen) return;
    updatePosition();
    const onResize = () => updatePosition();
    const onScroll = (e: Event) => {
      if (tooltipRef.current && e.target instanceof Node && tooltipRef.current.contains(e.target)) {
        return;
      }
      setTouchOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTouchOpen(false);
    };
    const onOutsideDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current &&
        !btnRef.current.contains(target) &&
        (!tooltipRef.current || !tooltipRef.current.contains(target))
      ) {
        setTouchOpen(false);
      }
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
  }, [touchOpen, updatePosition]);

  const defaultButtonClass =
    'inline-flex items-center justify-center text-zinc-500 hover:text-[#ff9900] focus:text-[#ff9900] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ff9900] rounded-sm transition-colors cursor-help align-middle shrink-0';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={touchOpen ? tooltipId : undefined}
        aria-expanded={touchOpen}
        data-tooltip-text={ariaText || (typeof content === 'string' ? content : title || label)}
        onMouseEnter={openTip}
        onMouseLeave={scheduleClose}
        onFocus={openTip}
        onBlur={closeImmediately}
        onClick={(e) => {
          e.stopPropagation();
          if (touchOpen) {
            closeImmediately();
          } else {
            openTip();
          }
        }}
        className={buttonClassName || defaultButtonClass}
      >
        <Info size={size} aria-hidden="true" />
      </button>
      {touchOpen &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              transform: coords.placement === 'top' ? 'translateY(-100%)' : undefined,
              zIndex: 9999,
            }}
            className="rounded bg-[#0a0a0a] border border-[#444] shadow-2xl shadow-black/95 px-2.5 py-2 font-mono text-[10.5px] leading-snug text-zinc-200 text-left normal-case tracking-normal font-normal"
          >
            <span
              aria-hidden="true"
              style={{ left: `${coords.arrowLeft - 4}px` }}
              className={`absolute w-2 h-2 rotate-45 bg-[#0a0a0a] ${
                coords.placement === 'bottom'
                  ? '-top-[5px] border-l border-t border-[#444]'
                  : '-bottom-[5px] border-r border-b border-[#444]'
              }`}
            />
            <div
              style={scrollable ? { maxHeight: `${coords.maxHeight}px` } : undefined}
              className={scrollable ? 'overflow-y-auto pr-1' : undefined}
            >
              {title && (
                <div className="text-[9.5px] font-bold uppercase tracking-wider text-[#ff9900] mb-1">
                  {title}
                </div>
              )}
              <div className="text-zinc-300">{content}</div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
