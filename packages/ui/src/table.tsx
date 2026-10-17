import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from './cn';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Accessible name of the table (`<caption>`), translated by the caller. */
  caption: ReactNode;
  /** Keeps the caption for assistive tech only (e.g. when a `PageHeader` already names it). */
  hideCaption?: boolean;
  /**
   * Below `md` each row becomes a card and each cell shows its header via `data-label`
   * (`.tt-table[data-stack]` in `tokens.css`). `never` keeps the table (it scrolls horizontally).
   */
  stackBelow?: 'md' | 'never';
}

const TableRoot = forwardRef<HTMLTableElement, TableProps>(function Table(
  { caption, hideCaption = false, stackBelow = 'md', className, children, ...props },
  ref,
) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        ref={ref}
        data-stack={stackBelow === 'md' ? '' : undefined}
        className={cn('tt-table w-full border-collapse text-sm text-fg', className)}
        {...props}
      >
        <caption
          className={cn(
            hideCaption ? 'sr-only' : 'px-3 py-2 text-start text-sm font-medium text-fg-muted',
          )}
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
});

const TableHead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableHead({ className, ...props }, ref) {
    return (
      <thead
        ref={ref}
        className={cn('border-b border-border bg-bg-subtle', className)}
        {...props}
      />
    );
  },
);

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableBody({ className, ...props }, ref) {
    return <tbody ref={ref} className={className} {...props} />;
  },
);

const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className, ...props }, ref) {
    return <tr ref={ref} className={cn('align-middle', className)} {...props} />;
  },
);

const TableTh = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  function TableTh({ scope = 'col', className, ...props }, ref) {
    return (
      <th
        ref={ref}
        scope={scope}
        className={cn(
          'px-3 py-2 text-start font-medium whitespace-nowrap text-fg-muted',
          className,
        )}
        {...props}
      />
    );
  },
);

export interface TableTdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Translated column header, shown before the value when rows stack (same string as the `Th`). */
  label?: string;
  /** End-aligned tabular digits. */
  numeric?: boolean;
}

const TableTd = forwardRef<HTMLTableCellElement, TableTdProps>(function TableTd(
  { label, numeric = false, className, ...props },
  ref,
) {
  return (
    <td
      ref={ref}
      data-label={label}
      className={cn(numeric && 'text-end tabular-nums', className)}
      {...props}
    />
  );
});

/** Row actions cell (buttons, menu trigger), aligned to inline-end. */
const TableActions = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  function TableActions({ className, children, ...props }, ref) {
    return (
      <td ref={ref} data-actions="" className={className} {...props}>
        <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
      </td>
    );
  },
);

/**
 * Native `<table>` with a caption, `scope="col"` headers and a stacked-card layout below `md`. Cell
 * padding and row rules come from `.tt-table` in `tokens.css` so the stacked layout can override them.
 */
export const Table = Object.assign(TableRoot, {
  Head: TableHead,
  Body: TableBody,
  Row: TableRow,
  Th: TableTh,
  Td: TableTd,
  Actions: TableActions,
});
