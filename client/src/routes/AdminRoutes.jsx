import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

const AdminLayout = lazy(() => import('../layouts/AdminLayout'));
const AdminLogin = lazy(() => import('../pages/admin/AdminLogin'));
const BookingsList = lazy(() => import('../pages/admin/BookingsList'));
const BookingDetail = lazy(() => import('../pages/admin/BookingDetail'));
const CabinsList = lazy(() => import('../pages/admin/CabinsList'));
const CabinEdit = lazy(() => import('../pages/admin/CabinEdit'));
const CabinTypesList = lazy(() => import('../pages/admin/CabinTypesList'));
const CabinTypeEdit = lazy(() => import('../pages/admin/CabinTypeEdit'));
const ReviewsList = lazy(() => import('../pages/admin/ReviewsList'));
const ReviewEdit = lazy(() => import('../pages/admin/ReviewEdit'));

const AdminRoutes = () => {
  return (
    <Suspense fallback={null}>
      <AdminLayout>
        <Routes>
          <Route path="login" element={<AdminLogin />} />
          <Route path="bookings" element={<BookingsList />} />
          <Route path="bookings/:id" element={<BookingDetail />} />
          <Route path="cabins" element={<CabinsList />} />
          <Route path="cabins/new" element={<CabinEdit />} />
          <Route path="cabins/:id" element={<CabinEdit />} />
          <Route path="cabin-types" element={<CabinTypesList />} />
          <Route path="cabin-types/:id" element={<CabinTypeEdit />} />
          <Route path="reviews" element={<ReviewsList />} />
          <Route path="reviews/:id" element={<ReviewEdit />} />
        </Routes>
      </AdminLayout>
    </Suspense>
  );
};

export default AdminRoutes;

