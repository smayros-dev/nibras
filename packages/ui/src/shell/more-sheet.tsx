'use client';

import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Sheet } from '../sheet';

export interface MoreSheetProps {
  labels: { more: string; closeMenu: string };
  triggerClassName?: string;
  /** Pre-rendered sheet body (nav list + extra), so only serialisable props cross into the client. */
  children: ReactNode;
}

/** The bottom nav's "More" button and the bottom sheet it opens. */
export function MoreSheet({ labels, triggerClassName, children }: MoreSheetProps) {
  return (
    <Sheet.Root>
      <Sheet.Trigger className={cn(triggerClassName)}>
        <Menu aria-hidden="true" className="size-5 shrink-0" />
        <span>{labels.more}</span>
      </Sheet.Trigger>
      <Sheet.Content side="bottom" title={labels.more} closeLabel={labels.closeMenu}>
        {children}
      </Sheet.Content>
    </Sheet.Root>
  );
}
