import React from 'react';

export interface StickyScreenHeaderProps {
  children: React.ReactNode;
  className?: string;
  headerRef?: React.Ref<HTMLDivElement>;
}

/**
 * StickyScreenHeader provides a responsive, opaque, sticky header wrapper for workspace screens.
 * Uses `lg:[@media(min-height:800px)]:-top-4 lg:[@media(min-height:800px)]:-mt-4 lg:[@media(min-height:800px)]:pt-4 lg:[@media(min-height:800px)]:sticky z-30 bg-black`
 * to seamlessly cover the parent scroller's top padding without peek gaps, while disabling sticky
 * pinning on narrow or short screens (<800px height or <1024px width).
 */
export const StickyScreenHeader: React.FC<StickyScreenHeaderProps> = ({
  children,
  className = '',
  headerRef,
}) => {
  return (
    <div
      ref={headerRef}
      className={`lg:[@media(min-height:800px)]:sticky lg:[@media(min-height:800px)]:-top-4 lg:[@media(min-height:800px)]:-mt-4 lg:[@media(min-height:800px)]:pt-4 z-30 bg-black pb-2.5 ${className}`}
    >
      {children}
    </div>
  );
};

export default StickyScreenHeader;
