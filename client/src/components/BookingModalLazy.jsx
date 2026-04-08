import { Component, lazy, Suspense, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBookingSearch } from '../context/BookingSearchContext';
import BookingModalLoadingShell from './BookingModalLoadingShell';

const importBookingModal = () => import('./BookingModal');
const BookingModal = lazy(importBookingModal);

function bookingModalDevLog(...args) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info('[booking-modal]', ...args);
  }
}

class BookingModalChunkErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err) {
    bookingModalDevLog('chunk/render error — closing modal', err?.message || err);
    this.props.onError?.();
  }

  render() {
    if (this.state.hasError) {
      return <BookingModalLoadingShell onClose={this.props.onClose} variant="error" />;
    }
    return this.props.children;
  }
}

export default function BookingModalLazy() {
  const { isModalOpen, closeModal } = useBookingSearch();
  const openCycleRef = useRef(0);

  // Prefetch chunk on idle and on first pointer interaction (before open).
  useEffect(() => {
    let cancelled = false;
    const kick = () => {
      importBookingModal().then(
        () => {
          if (!cancelled) bookingModalDevLog('modal chunk prefetch resolved');
        },
        (e) => {
          if (!cancelled) bookingModalDevLog('modal chunk prefetch failed', e?.message || e);
        }
      );
    };
    let idleId;
    let idleIsRic = false;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleIsRic = true;
      idleId = window.requestIdleCallback(() => kick(), { timeout: 2500 });
    } else if (typeof window !== 'undefined') {
      idleId = window.setTimeout(kick, 0);
    }
    const onPointerDown = () => {
      kick();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true, once: true });
    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (typeof window !== 'undefined' && idleId !== undefined) {
        if (idleIsRic && typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleId);
        } else {
          window.clearTimeout(idleId);
        }
      }
    };
  }, []);

  // Single owner of body scroll lock for the whole open lifecycle (loading shell + modal).
  useEffect(() => {
    if (!isModalOpen) return undefined;
    openCycleRef.current += 1;
    const cycle = openCycleRef.current;
    bookingModalDevLog('open requested — body lock on (cycle', cycle, ')');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      bookingModalDevLog('cleanup — body lock off (cycle', cycle, ')');
    };
  }, [isModalOpen]);

  useEffect(() => {
    if (isModalOpen) {
      bookingModalDevLog('blocker path active — portaled shell or BookingModal');
    }
  }, [isModalOpen]);

  if (!isModalOpen) {
    return null;
  }

  const handleBoundaryError = () => {
    closeModal();
  };

  if (typeof document === 'undefined') {
    return null;
  }

  const portaledTree = (
    <BookingModalChunkErrorBoundary onClose={closeModal} onError={handleBoundaryError}>
      <Suspense
        fallback={
          <BookingModalLoadingShell onClose={closeModal} />
        }
      >
        <BookingModal />
      </Suspense>
    </BookingModalChunkErrorBoundary>
  );

  return createPortal(portaledTree, document.body);
}
