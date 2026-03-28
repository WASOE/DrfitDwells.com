import { lazy, Suspense, useEffect, useState } from 'react';
import { useBookingSearch } from '../context/BookingSearchContext';

const BookingModal = lazy(() => import('./BookingModal'));

export default function BookingModalLazy() {
  const { isModalOpen } = useBookingSearch();
  const [shouldLoad, setShouldLoad] = useState(isModalOpen);

  useEffect(() => {
    if (isModalOpen) setShouldLoad(true);
  }, [isModalOpen]);

  if (!shouldLoad) return null;

  return (
    <Suspense fallback={null}>
      <BookingModal />
    </Suspense>
  );
}
