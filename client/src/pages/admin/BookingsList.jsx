import AdminLayout from '../../components/admin/AdminLayout';
import BookingsTable from '../../components/admin/BookingsTable';

const BookingsList = () => {
  return (
    <AdminLayout>
      <div className="px-4 sm:px-0">
        <div className="sm:flex sm:items-center">
          <div className="sm:flex-auto">
            <h1 className="text-2xl font-playfair font-bold text-gray-900">
              Bookings
            </h1>
            <p className="mt-2 text-sm text-gray-700">
              Manage and view all cabin bookings
            </p>
          </div>
        </div>

        <div className="mt-8">
          <BookingsTable />
        </div>
      </div>
    </AdminLayout>
  );
};

export default BookingsList;
