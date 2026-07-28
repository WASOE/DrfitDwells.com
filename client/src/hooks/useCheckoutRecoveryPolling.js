import { useCallback, useEffect, useRef, useState } from 'react';
import { bookingAPI } from '../services/api';
import { trackFunnelEvent } from '../tracking/funnel';
import {
  computeNextPollIntervalMs,
  isTerminalRecoveryStatus,
  shouldShowDelayedCopy
} from '../utils/checkoutRecoveryPolling';

/**
 * Polls GET checkout-sessions/:id/status until terminal.
 */
export function useCheckoutRecoveryPolling({
  checkoutId,
  enabled,
  onConfirmed,
  onNeedsReview,
  onPaymentFailed
} = {}) {
  const [statusPayload, setStatusPayload] = useState(null);
  const [networkError, setNetworkError] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(Date.now());
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const consecutiveErrorsRef = useRef(0);
  const firedEventsRef = useRef(new Set());
  const stoppedRef = useRef(false);

  const fireOnce = useCallback((eventType, fields = {}) => {
    if (firedEventsRef.current.has(eventType)) return;
    firedEventsRef.current.add(eventType);
    trackFunnelEvent(eventType, {
      checkoutId: checkoutId || undefined,
      ...fields
    });
  }, [checkoutId]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clearTimer();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [clearTimer]);

  useEffect(() => {
    if (!enabled || !checkoutId) return undefined;

    stoppedRef.current = false;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    fireOnce('checkout_finalization_processing_viewed');

    const schedule = (delayMs) => {
      clearTimer();
      if (stoppedRef.current) return;
      timerRef.current = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (stoppedRef.current) return;
      setElapsedMs(Date.now() - startedAtRef.current);

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await bookingAPI.getCheckoutRecoveryStatus(checkoutId, {
          signal: controller.signal
        });
        if (stoppedRef.current) return;
        consecutiveErrorsRef.current = 0;
        setNetworkError(false);

        if (!result?.success || !result.status) {
          consecutiveErrorsRef.current += 1;
          setNetworkError(true);
        } else {
          setStatusPayload(result);
          const status = result.status;

          if (status === 'confirmed') {
            fireOnce('checkout_finalization_confirmed', {
              bookingId: result.bookingId || undefined
            });
            stop();
            if (typeof onConfirmed === 'function') onConfirmed(result);
            return;
          }
          if (status === 'needs_review') {
            fireOnce('checkout_finalization_needs_review');
            stop();
            if (typeof onNeedsReview === 'function') onNeedsReview(result);
            return;
          }
          if (status === 'payment_failed') {
            fireOnce('checkout_payment_definitively_failed');
            stop();
            if (typeof onPaymentFailed === 'function') onPaymentFailed(result);
            return;
          }

          const elapsed = Date.now() - startedAtRef.current;
          if (shouldShowDelayedCopy(elapsed)) {
            fireOnce('checkout_finalization_delayed');
          }
        }
      } catch (err) {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED' || controller.signal.aborted) {
          return;
        }
        consecutiveErrorsRef.current += 1;
        setNetworkError(true);
      }

      if (stoppedRef.current) return;
      const next = computeNextPollIntervalMs({
        elapsedMs: Date.now() - startedAtRef.current,
        consecutiveErrors: consecutiveErrorsRef.current,
        documentHidden: typeof document !== 'undefined' && document.hidden
      });
      schedule(next);
    };

    const onVisibility = () => {
      if (stoppedRef.current) return;
      if (typeof document !== 'undefined' && !document.hidden) {
        clearTimer();
        void tick();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    void tick();

    return () => {
      stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [checkoutId, enabled, fireOnce, onConfirmed, onNeedsReview, onPaymentFailed, clearTimer, stop]);

  return {
    statusPayload,
    networkError,
    elapsedMs,
    delayed: shouldShowDelayedCopy(elapsedMs),
    stop,
    isTerminal: isTerminalRecoveryStatus(statusPayload?.status)
  };
}
