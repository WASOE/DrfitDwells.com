import BookingsTable from '../../components/admin/BookingsTable';

const BookingsList = () => {
  return (
    <div className="px-4 sm:px-0">
      <header className="mb-10">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">
          Bookings
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Manage and view all cabin bookings
        </p>
      </header>

      <div>
        <BookingsTable />
      </div>
    </div>
  );
};

export default BookingsList;
