'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@nibras/ui';
import { GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, type ReactNode } from 'react';

export interface SortableListProps<T extends { id: string }> {
  items: T[];
  /** Accessible name of the list. */
  label: string;
  titleOf: (item: T) => string;
  disabled?: boolean;
  /** The full new order of ids after a drop that moved an item. */
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, ctx: { handle: ReactNode; index: number }) => ReactNode;
  className?: string;
}

/**
 * A vertical drag-and-drop list (dnd-kit): mouse/touch through the grip, and the keyboard —
 * focus the grip, Space or Enter to pick up, ↑/↓ to move, Space/Enter to drop, Escape to cancel
 * (`KeyboardSensor` + `sortableKeyboardCoordinates`). Up/down do not depend on the reading
 * direction, so the same keys work in RTL. Instructions and live announcements are translated
 * (fr/ar/en). Rows also keep a « Monter / Descendre » menu (the caller's), the non-drag path.
 */
export function SortableList<T extends { id: string }>({
  items,
  label,
  titleOf,
  disabled = false,
  onReorder,
  renderItem,
  className,
}: SortableListProps<T>) {
  const t = useTranslations();
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = useMemo(() => items.map((i) => i.id), [items]);

  const announcements = useMemo<Announcements>(() => {
    const title = (key: UniqueIdentifier) => {
      const item = items.find((i) => i.id === key);
      return item ? titleOf(item) : String(key);
    };
    const position = (key: UniqueIdentifier | undefined) => ids.indexOf(String(key)) + 1;
    const total = ids.length;
    return {
      onDragStart: ({ active }) =>
        t('structure.dndPickedUp', {
          title: title(active.id),
          position: position(active.id),
          total,
        }),
      onDragOver: ({ active, over }) =>
        over
          ? t('structure.dndOver', { title: title(active.id), position: position(over.id), total })
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t('structure.dndDropped', {
              title: title(active.id),
              position: position(over.id),
              total,
            })
          : t('structure.dndCancelled', { title: title(active.id) }),
      onDragCancel: ({ active }) => t('structure.dndCancelled', { title: title(active.id) }),
    };
  }, [ids, items, t, titleOf]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('structure.dndInstructions') },
      }}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ul aria-label={label} className={cn('flex flex-col gap-3', className)}>
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              id={item.id}
              index={index}
              title={titleOf(item)}
              disabled={disabled}
            >
              {(handle) => renderItem(item, { handle, index })}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  index,
  title,
  disabled,
  children,
}: {
  id: string;
  index: number;
  title: string;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const t = useTranslations();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled, attributes: { roleDescription: t('structure.sortable') } });
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t('structure.dragHandle', { title })}
      className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-fg-muted hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:cursor-grabbing"
    >
      <GripVertical aria-hidden="true" className="size-5" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      data-sortable-index={index}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10 opacity-80')}
    >
      {children(handle)}
    </li>
  );
}
