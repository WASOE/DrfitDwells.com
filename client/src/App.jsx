import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { BookingProvider } from './context/BookingContext'
import ScrollToTop from './components/ScrollToTop'
import ErrorBoundary from './components/ErrorBoundary'
import SiteLayout from './layouts/SiteLayout'
import AdminLayout from './layouts/AdminLayout'
import EmbeddedLayout from './layouts/EmbeddedLayout'

const Home = lazy(() => import('./pages/Home'))
const SearchResults = lazy(() => import('./pages/SearchResults'))
const CabinDetails = lazy(() => import('./pages/CabinDetails'))
const AFrameDetails = lazy(() => import('./pages/AFrameDetails'))
const BookingSuccess = lazy(() => import('./pages/BookingSuccess'))
const ValleyGuide = lazy(() => import('./pages/ValleyGuide'))
const TheCabin = lazy(() => import('./pages/TheCabin'))
const CabinFaqPage = lazy(() => import('./pages/CabinFaqPage'))
const TheValleyPage = lazy(() => import('./pages/the-valley/TheValleyPage'))
const About = lazy(() => import('./pages/About'))
const Build = lazy(() => import('./pages/Build'))
const Terms = lazy(() => import('./pages/legal/Terms'))
const Privacy = lazy(() => import('./pages/legal/Privacy'))
const CancellationPolicy = lazy(() => import('./pages/legal/CancellationPolicy'))
const Career = lazy(() => import('./pages/legal/Career'))
const Press = lazy(() => import('./pages/legal/Press'))
const Step1TripType = lazy(() => import('./pages/craft/Step1TripType'))
const Step2ArrivalMethod = lazy(() => import('./pages/craft/Step2ArrivalMethod'))
const Step3GuestDetails = lazy(() => import('./pages/craft/Step3GuestDetails'))
const Step4Summary = lazy(() => import('./pages/craft/Step4Summary'))

const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const BookingsList = lazy(() => import('./pages/admin/BookingsList'))
const BookingDetail = lazy(() => import('./pages/admin/BookingDetail'))
const CabinsList = lazy(() => import('./pages/admin/CabinsList'))
const CabinEdit = lazy(() => import('./pages/admin/CabinEdit'))
const CabinTypesList = lazy(() => import('./pages/admin/CabinTypesList'))
const CabinTypeEdit = lazy(() => import('./pages/admin/CabinTypeEdit'))
const ReviewsList = lazy(() => import('./pages/admin/ReviewsList'))
const ReviewEdit = lazy(() => import('./pages/admin/ReviewEdit'))

const CraftEmbedded = lazy(() => import('./pages/embedded/CraftEmbedded'))

const ConfirmBooking = lazy(() => import('./pages/ConfirmBooking'))
const BookingRefundResolution = lazy(() => import('./pages/BookingRefundResolution'))

const OffGridCabinsBulgaria = lazy(() => import('./pages/seo/OffGridCabinsBulgaria'))
const RhodopesCabinRetreat = lazy(() => import('./pages/seo/RhodopesCabinRetreat'))
const BanskoRemoteWorkRetreat = lazy(() => import('./pages/seo/BanskoRemoteWorkRetreat'))
const RetreatVenueBulgaria = lazy(() => import('./pages/seo/RetreatVenueBulgaria'))

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="text-sm tracking-[0.3em] uppercase text-gray-400">Loading...</div>
  </div>
)

function App() {
  return (
    <ErrorBoundary>
      <BookingProvider>
        <ScrollToTop />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Site (guest) layout */}
            <Route element={<SiteLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/bg" element={<Home />} />
              <Route path="/search" element={<SearchResults />} />
              <Route path="/bg/search" element={<SearchResults />} />
              <Route path="/cabin" element={<TheCabin />} />
              <Route path="/bg/cabin" element={<TheCabin />} />
              <Route path="/cabin/faq" element={<CabinFaqPage />} />
              <Route path="/bg/cabin/faq" element={<CabinFaqPage />} />
              <Route path="/valley" element={<TheValleyPage />} />
              <Route path="/bg/valley" element={<TheValleyPage />} />
              <Route path="/about" element={<About />} />
              <Route path="/bg/about" element={<About />} />
              <Route path="/build" element={<Build />} />
              <Route path="/journal" element={<Navigate to="/build" replace />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/cancellation-policy" element={<CancellationPolicy />} />
              <Route path="/career" element={<Career />} />
              <Route path="/press" element={<Press />} />
              <Route path="/cabin/:id/confirm" element={<ConfirmBooking />} />
              <Route path="/bg/cabin/:id/confirm" element={<ConfirmBooking />} />
              <Route path="/stays/a-frame/confirm" element={<ConfirmBooking />} />
              <Route path="/bg/stays/a-frame/confirm" element={<ConfirmBooking />} />
              <Route path="/cabin/:id" element={<CabinDetails />} />
              <Route path="/bg/cabin/:id" element={<CabinDetails />} />
              <Route path="/booking-refund" element={<BookingRefundResolution />} />
              <Route path="/bg/booking-refund" element={<BookingRefundResolution />} />
              <Route path="/stays/a-frame" element={<AFrameDetails />} />
              <Route path="/bg/stays/a-frame" element={<AFrameDetails />} />
              <Route path="/booking-success/:id" element={<BookingSuccess />} />
              <Route path="/bg/booking-success/:id" element={<BookingSuccess />} />
              <Route path="/my-trip/:bookingId/valley-guide" element={<ValleyGuide />} />
              <Route path="/bg/my-trip/:bookingId/valley-guide" element={<ValleyGuide />} />

              {/* Craft flow */}
              <Route path="/craft/step-1" element={<Step1TripType />} />
              <Route path="/craft/step-2" element={<Step2ArrivalMethod />} />
              <Route path="/craft/step-3" element={<Step3GuestDetails />} />
              <Route path="/craft/step-4" element={<Step4Summary />} />

              {/* SEO landing pages */}
              <Route path="/off-grid-cabins-bulgaria" element={<OffGridCabinsBulgaria />} />
              <Route path="/bg/off-grid-cabins-bulgaria" element={<OffGridCabinsBulgaria />} />
              <Route path="/rhodopes-cabin-retreat" element={<RhodopesCabinRetreat />} />
              <Route path="/bg/rhodopes-cabin-retreat" element={<RhodopesCabinRetreat />} />
              <Route path="/bansko-remote-work-retreat" element={<BanskoRemoteWorkRetreat />} />
              <Route path="/bg/bansko-remote-work-retreat" element={<BanskoRemoteWorkRetreat />} />
              <Route path="/retreat-venue-bulgaria" element={<RetreatVenueBulgaria />} />
              <Route path="/bg/retreat-venue-bulgaria" element={<RetreatVenueBulgaria />} />
            </Route>

            {/* Admin layout */}
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

            {/* Embedded layout */}
            <Route element={<EmbeddedLayout />}>
              <Route path="/embedded/craft" element={<CraftEmbedded />} />
            </Route>
          </Routes>
        </Suspense>
      </BookingProvider>
    </ErrorBoundary>
  )
}

export default App
