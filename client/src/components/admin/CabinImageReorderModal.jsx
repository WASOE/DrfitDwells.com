/**
 * Full-gallery reorder (dnd-kit visual grid). Persists through CabinEdit; parent applies `applyAdminImageSort` to the PATCH response and the modal reapplies cover/others from the returned list.
 * Cover pinned first (non-draggable); sortable grid for the rest. Save on drop only; revert on API failure.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';

/** 4:3 photo card — object-cover for recognition; not forced square. */
function SortablePhotoTile({ item, displayIndex }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item._id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  const label = item.alt?.trim() || `Image ${displayIndex}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative touch-manipulation ${isDragging ? 'z-10 opacity-40' : 'z-0 opacity-100'}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}, position ${displayIndex}. Drag to reorder.`}
        className="group relative aspect-[4/3] w-full cursor-grab overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm ring-0 transition-shadow active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-[#81887A] focus-visible:ring-offset-2"
        {...attributes}
        {...listeners}
      >
        <img
          src={item.url}
          alt=""
          className="h-full w-full object-cover select-none"
          draggable={false}
        />
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium tabular-nums text-white">
          {displayIndex}
        </span>
      </div>
    </div>
  );
}

function CoverPinnedPhoto({ item }) {
  return (
    <div className="mb-5 max-w-xl mx-auto">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 shadow-sm">
        <img src={item.url} alt="" className="h-full w-full object-cover" draggable={false} />
        <span className="absolute left-2 top-2 rounded-full bg-[#81887A] px-2 py-0.5 text-[11px] font-semibold text-white">
          Cover
        </span>
        <span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          #1
        </span>
      </div>
    </div>
  );
}

function OverlayPhotoCard({ item, displayIndex }) {
  return (
    <div
      className="w-[min(42vw,220px)] sm:w-[min(28vw,260px)] cursor-grabbing touch-manipulation"
      aria-hidden
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border-2 border-white bg-gray-100 shadow-2xl ring-2 ring-black/10">
        <img src={item.url} alt="" className="h-full w-full object-cover" draggable={false} />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
          {displayIndex}
        </span>
      </div>
    </div>
  );
}

export default function CabinImageReorderModal({ open, onClose, images, onPersist }) {
  const [cover, setCover] = useState(null);
  const [others, setOthers] = useState([]);
  const [activeId, setActiveId] = useState(null);
  /** idle | saving | saved — subtle header feedback only */
  const [saveStatus, setSaveStatus] = useState('idle');
  const savedClearTimerRef = useRef(null);
  /** When true, initial cover/others were loaded for this open — do not reset on parent `images` updates after each persist. */
  const gallerySyncedForOpenRef = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 }
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 220,
        tolerance: 8
      }
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!open) return;
    setSaveStatus('idle');
    if (savedClearTimerRef.current) {
      clearTimeout(savedClearTimerRef.current);
      savedClearTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      gallerySyncedForOpenRef.current = false;
      return;
    }
    if (!images?.length) return;
    if (gallerySyncedForOpenRef.current) return;
    gallerySyncedForOpenRef.current = true;

    const cov = images.find((i) => i.isCover) || null;
    const tail = cov ? images.filter((i) => String(i._id) !== String(cov._id)) : [...images];
    setCover(cov);
    setOthers(tail);
    setActiveId(null);
  }, [open, images]);

  useEffect(
    () => () => {
      if (savedClearTimerRef.current) clearTimeout(savedClearTimerRef.current);
    },
    []
  );

  const runPersist = useCallback(
    async (nextOthers) => {
      const prev = others.slice();
      setOthers(nextOthers);
      const fullOrdered = cover ? [cover, ...nextOthers] : nextOthers;
      if (savedClearTimerRef.current) {
        clearTimeout(savedClearTimerRef.current);
        savedClearTimerRef.current = null;
      }
      setSaveStatus('saving');
      try {
        const merged = await onPersist(fullOrdered);
        if (Array.isArray(merged) && merged.length > 0) {
          const cov = merged.find((i) => i.isCover) || null;
          const tail = cov
            ? merged.filter((i) => String(i._id) !== String(cov._id))
            : [...merged];
          setCover(cov);
          setOthers(tail);
        }
        setSaveStatus('saved');
        savedClearTimerRef.current = setTimeout(() => {
          setSaveStatus('idle');
          savedClearTimerRef.current = null;
        }, 2000);
      } catch {
        setOthers(prev);
        setSaveStatus('idle');
      }
    },
    [cover, others, onPersist]
  );

  const onDragEnd = useCallback(
    (event) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over || active.id === over.id) return;
      const oldIndex = others.findIndex((o) => o._id === active.id);
      const newIndex = others.findIndex((o) => o._id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(others, oldIndex, newIndex);
      void runPersist(next);
    },
    [others, runPersist]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const sortableIds = others.map((o) => o._id);
  const activeItem = activeId ? others.find((o) => o._id === activeId) : null;
  const activeDisplayIndex = activeItem ? (cover ? 2 : 1) + others.indexOf(activeItem) : 0;

  const layer = (
    <div
      className="fixed inset-0 z-[195] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cabin-reorder-title"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 z-0 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[min(94dvh,960px)] w-full max-w-5xl flex-col rounded-t-2xl border border-gray-200 bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="cabin-reorder-title" className="text-lg font-semibold text-gray-900">
                Reorder photos
              </h2>
              {saveStatus === 'saving' && (
                <span className="text-xs font-medium text-gray-500" aria-live="polite">
                  Saving…
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="text-xs font-medium text-[#5a6b52]" aria-live="polite">
                  Saved
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">Drag to reorder · on touch, hold briefly first</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Close reorder"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-6">
          {cover && <CoverPinnedPhoto item={cover} />}

          {others.length === 0 && !cover && (
            <p className="py-12 text-center text-sm text-gray-500">No images to reorder.</p>
          )}

          {others.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              autoScroll={{
                threshold: { x: 0.2, y: 0.2 },
                acceleration: 12,
                interval: 5
              }}
              onDragStart={({ active }) => setActiveId(active.id)}
              onDragCancel={() => setActiveId(null)}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
                <div
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 max-w-5xl mx-auto pb-6"
                  role="list"
                >
                  {others.map((item, idx) => (
                    <div key={item._id} role="listitem">
                      <SortablePhotoTile item={item} displayIndex={(cover ? 2 : 1) + idx} />
                    </div>
                  ))}
                </div>
              </SortableContext>
              <DragOverlay adjustScale={false} dropAnimation={null}>
                {activeItem ? (
                  <OverlayPhotoCard item={activeItem} displayIndex={activeDisplayIndex} />
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(layer, document.body);
}
