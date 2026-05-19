import * as React from 'react';
import { cn } from '@/lib/utils';

type EyebrowVariant = 'curly' | 'slash' | 'numbered';

interface EyebrowProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: EyebrowVariant;
  /** For variant="numbered": the numeric prefix, e.g. 1 → //R.01 */
  index?: number;
}

/**
 * Arc-grammar eyebrow labels.
 *
 *   curly    →  {lowercase_underscore}   used for major section eyebrows
 *   slash    →  //Label                  used for nav groupings / footer columns
 *   numbered →  //R.01                   used for resource lists / numbered CTAs
 */
export function Eyebrow({
  variant = 'slash',
  index,
  className,
  children,
  ...props
}: EyebrowProps) {
  if (variant === 'numbered') {
    const padded = String(index ?? 1).padStart(2, '0');
    return (
      <span
        className={cn(
          'font-mono text-xs uppercase tracking-[0.1em] text-fg-dim',
          className,
        )}
        {...props}
      >
        <span className="text-fg-dim">//R.{padded}</span>
        {children ? <span className="ml-2 text-fg-mute">{children}</span> : null}
      </span>
    );
  }

  if (variant === 'curly') {
    return (
      <span
        className={cn(
          'font-mono text-xs uppercase tracking-[0.1em] text-fg-dim',
          className,
        )}
        {...props}
      >
        <span aria-hidden>{'{'}</span>
        {children}
        <span aria-hidden>{'}'}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'font-mono text-xs uppercase tracking-[0.1em] text-fg-dim',
        className,
      )}
      {...props}
    >
      <span aria-hidden>//</span>
      {children}
    </span>
  );
}
