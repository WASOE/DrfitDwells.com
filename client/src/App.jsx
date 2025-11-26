import { Routes, Route } from 'react-router-dom'
import { BookingProvider } from './context/BookingContext'
import SiteLayout from './layouts/SiteLayout'
import AdminLayout from './layouts/AdminLayout'
import EmbeddedLayout from './layouts/EmbeddedLayout'

// Guest pages
import Home from './pages/Home'
import SearchResults from './pages/SearchResults'
import CabinDetails from './pages/CabinDetails'
import AFrameDetails from './pages/AFrameDetails'
import BookingSuccess from './pages/BookingSuccess'
import ValleyGuide from './pages/ValleyGuide'
import Step1TripType from './pages/craft/Step1TripType'
import Step2ArrivalMethod from './pages/craft/Step2ArrivalMethod'
import Step3GuestDetails from './pages/craft/Step3GuestDetails'
import Step4Summary from './pages/craft/Step4Summary'

// Admin pages
import AdminLogin from './pages/admin/AdminLogin'
import BookingsList from './pages/admin/BookingsList'
import BookingDetail from './pages/admin/BookingDetail'
import CabinsList from './pages/admin/CabinsList'
import CabinEdit from './pages/admin/CabinEdit'
import CabinTypesList from './pages/admin/CabinTypesList'
import CabinTypeEdit from './pages/admin/CabinTypeEdit'
import ReviewsList from './pages/admin/ReviewsList'
import ReviewEdit from './pages/admin/ReviewEdit'

// Embedded pages
import CraftEmbedded from './pages/embedded/CraftEmbedded'

function App() {
  return (
    <BookingProvider>
      <Routes>
        {/* Site (guest) layout */}
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/cabin/:id" element={<CabinDetails />} />
          <Route path="/stays/a-frame" element={<AFrameDetails />} />
          <Route path="/booking-success/:id" element={<BookingSuccess />} />
          <Route path="/my-trip/:bookingId/valley-guide" element={<ValleyGuide />} />
          
          {/* Craft flow (guest-visible steps) */}
          <Route path="/craft/step-1" element={<Step1TripType />} />
          <Route path="/craft/step-2" element={<Step2ArrivalMethod />} />
          <Route path="/craft/step-3" element={<Step3GuestDetails />} />
          <Route path="/craft/step-4" element={<Step4Summary />} />
        </Route>

        {/* Admin layout (no global header/footer) */}
        <Route element={<AdminLayout />}>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/bookings" element={<BookingsList />} />
          <Route path="/admin/bookings/:id" element={<BookingDetail />} />
          <Route path="/admin/cabins" element={<CabinsList />} />
          <Route path="/admin/cabins/new" element={<CabinEdit />} />
          <Route path="/admin/cabins/:id" element={<CabinEdit />} />
          <Route path="/admin/cabin-types" element={<CabinTypesList />} />
          <Route path="/admin/cabin-types/:id" element={<CabinTypeEdit />} />
          <Route path="/admin/reviews" element={<ReviewsList />} />
          <Route path="/admin/reviews/:id" element={<ReviewEdit />} />
        </Route>

        {/* Embedded layout (headerless for iframe) */}
        <Route element={<EmbeddedLayout />}>
          <Route path="/embedded/craft" element={<CraftEmbedded />} />
        </Route>
      </Routes>
    </BookingProvider>
  )
}

export default App