import React, { SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface TerminalSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
  sizeVariant?: 'sm' | 'base' | 'md';
  chevronColorClass?: string;
}

export const TerminalSelect = forwardRef<HTMLSelectElement, TerminalSelectProps>(
  (
    {
      className = '',
      containerClassName = 'relative inline-block',
      sizeVariant = 'md',
      chevronColorClass = 'text-zinc-400',
      children,
      ...props
    },
    ref
  ) => {
    const pyClass =
      sizeVariant === 'sm' ? 'py-0.5' : sizeVariant === 'base' ? 'py-1' : 'py-1.5';
    const baseSelectClasses = `appearance-none bg-black border border-[#333] hover:border-[#ff9900] focus:border-[#ff9900] rounded pl-2 pr-7 text-xs text-zinc-200 outline-none cursor-pointer ${pyClass}`;

    return (
      <div className={containerClassName}>
        <select ref={ref} className={`${baseSelectClasses} ${className}`} {...props}>
          {children}
        </select>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${chevronColorClass}`}
        />
      </div>
    );
  }
);

TerminalSelect.displayName = 'TerminalSelect';

export default TerminalSelect;
