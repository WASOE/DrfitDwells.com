import { Outlet } from 'react-router-dom';
import { BookingProvider } from '../context/BookingContext';

/**
 * Wraps routes that call useBookingContext (search, cabin detail, craft, etc.).
 * Keeps BookingProvider + reducer out of the initial graph for / and other marketing routes.
 */
export default function BookingProviderLayout() {
  return (
    <BookingProvider>
      <Outlet />
    </BookingProvider>
  );
}
