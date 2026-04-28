import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { BookingProvider } from './context/BookingContext'
import BookingProviderLayout from './layouts/BookingProviderLayout'
import ScrollToTop from './components/ScrollToTop'

/** Guest shell (header, outlet, modals) — lazy so admin/ops layouts stay out of the initial graph. */
const SiteLayout = lazy(() => import('./layouts/SiteLayout'))
const AdminLayout = lazy(() => import('./layouts/AdminLayout'))
const OpsLayout = lazy(() => import('./layouts/OpsLayout'))
const MaintenanceLayout = lazy(() => import('./layouts/MaintenanceLayout'))
const EmbeddedLayout = lazy(() => import('./layouts/EmbeddedLayout'))
const NotFoundLayout = lazy(() => import('./layouts/NotFoundLayout'))

const Home = lazy(() => import('./pages/Home'))
const SearchResults = lazy(() => import('./pages/SearchResults'))
const CabinDetails = lazy(() => import('./pages/CabinDetails'))
const AFrameDetails = lazy(() => import('./pages/AFrameDetails'))
const BookingSuccess = lazy(() => import('./pages/BookingSuccess'))
const ValleyGuide = lazy(() => import('./pages/ValleyGuide'))
const ValleyPublicGuide = lazy(() => import('./pages/guides/ValleyPublicGuide'))
const TheCabinPublicGuide = lazy(() => import('./pages/guides/TheCabinPublicGuide'))
const ValleyStayPublicGuide = lazy(() => import('./pages/guides/ValleyStayPublicGuide'))
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
const CabinsList = lazy(() => import('./pages/admin/CabinsList'))
const CabinEdit = lazy(() => import('./pages/admin/CabinEdit'))
const CabinTypesList = lazy(() => import('./pages/admin/CabinTypesList'))
const CabinTypeEdit = lazy(() => import('./pages/admin/CabinTypeEdit'))
const ReviewsList = lazy(() => import('./pages/admin/ReviewsList'))
const ReviewEdit = lazy(() => import('./pages/admin/ReviewEdit'))
const PromoCodesList = lazy(() => import('./pages/admin/PromoCodesList'))
const OpsDashboard = lazy(() => import('./pages/ops/OpsDashboard'))
const OpsCalendarIndex = lazy(() => import('./pages/ops/calendar/OpsCalendarIndex'))
const OpsCalendarMonth = lazy(() => import('./pages/ops/calendar/OpsCalendarMonth'))
const OpsReservations = lazy(() => import('./pages/ops/OpsReservations'))
const OpsReservationDetail = lazy(() => import('./pages/ops/OpsReservationDetail'))
const OpsPayments = lazy(() => import('./pages/ops/OpsPayments'))
const OpsSyncCenter = lazy(() => import('./pages/ops/OpsSyncCenter'))
const OpsCabinsDetail = lazy(() => import('./pages/ops/OpsCabins'))
const OpsCabinsList = lazy(() => import('./pages/ops/OpsCabins').then((m) => ({ default: m.OpsCabinsList })))
const OpsReviews = lazy(() => import('./pages/ops/OpsReviews'))
const OpsCommunicationOversight = lazy(() => import('./pages/ops/OpsCommunicationOversight'))
const OpsManualReviewBacklog = lazy(() => import('./pages/ops/OpsManualReviewBacklog'))
const OpsReadiness = lazy(() => import('./pages/ops/OpsReadiness'))
const MaintenanceHome = lazy(() => import('./pages/maintenance/MaintenanceHome'))
const MaintenanceCabins = lazy(() => import('./pages/maintenance/MaintenanceCabins'))
const MaintenanceReservations = lazy(() => import('./pages/maintenance/MaintenanceReservations'))
const MaintenanceSync = lazy(() => import('./pages/maintenance/MaintenanceSync'))
const MaintenanceCleanup = lazy(() => import('./pages/maintenance/MaintenanceCleanup'))
const MaintenanceArchived = lazy(() => import('./pages/maintenance/MaintenanceArchived'))

const CraftEmbedded = lazy(() => import('./pages/embedded/CraftEmbedded'))

const ConfirmBooking = lazy(() => import('./pages/ConfirmBooking'))
const BookingRefundResolution = lazy(() => import('./pages/BookingRefundResolution'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

const OffGridCabinsBulgaria = lazy(() => import('./pages/seo/OffGridCabinsBulgaria'))
const RhodopesCabinRetreat = lazy(() => import('./pages/seo/RhodopesCabinRetreat'))
const BanskoRemoteWorkRetreat = lazy(() => import('./pages/seo/BanskoRemoteWorkRetreat'))
const RetreatVenueBulgaria = lazy(() => import('./pages/seo/RetreatVenueBulgaria'))
const OffGridStaysBulgaria = lazy(() => import('./pages/seo/OffGridStaysBulgaria'))

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="text-sm tracking-[0.3em] uppercase text-gray-400">Loading...</div>
  </div>
)

const AdminBookingDetailRedirect = () => {
  const { id } = useParams()
  return <Navigate to={`/ops/reservations/${id}`} replace />
}

function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<PageLoader />}>
        <Routes>
            {/* Site (guest) layout */}
            <Route element={<SiteLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/bg" element={<Home />} />
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
              <Route path="/terms-and-conditions-drift-dwells" element={<Navigate to="/terms" replace />} />
              <Route path="/terms-and-conditions-drift-dwells/" element={<Navigate to="/terms" replace />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/cancellation-policy" element={<CancellationPolicy />} />
              <Route path="/career" element={<Career />} />
              <Route path="/press" element={<Press />} />
              <Route path="/stays/a-frame/confirm" element={<ConfirmBooking />} />
              <Route path="/bg/stays/a-frame/confirm" element={<ConfirmBooking />} />
              <Route path="/booking-refund" element={<BookingRefundResolution />} />
              <Route path="/bg/booking-refund" element={<BookingRefundResolution />} />
              <Route path="/stays/a-frame" element={<AFrameDetails />} />
              <Route path="/bg/stays/a-frame" element={<AFrameDetails />} />
              <Route path="/booking-success/:id" element={<BookingSuccess />} />
              <Route path="/bg/booking-success/:id" element={<BookingSuccess />} />
              <Route path="/my-trip/:bookingId/valley-guide" element={<ValleyGuide />} />
              <Route path="/bg/my-trip/:bookingId/valley-guide" element={<ValleyGuide />} />
              <Route path="/guides/the-valley" element={<ValleyPublicGuide />} />
              <Route path="/guides/the-valley/:staySlug" element={<ValleyStayPublicGuide />} />
              <Route path="/guides/the-cabin" element={<TheCabinPublicGuide />} />
              <Route path="/guides/cabin/:slug" element={<Navigate to="/guides/the-valley" replace />} />

              {/* SEO landing pages */}
              <Route path="/off-grid-cabins-bulgaria" element={<OffGridCabinsBulgaria />} />
              <Route path="/bg/off-grid-cabins-bulgaria" element={<OffGridCabinsBulgaria />} />
              <Route path="/rhodopes-cabin-retreat" element={<RhodopesCabinRetreat />} />
              <Route path="/bg/rhodopes-cabin-retreat" element={<RhodopesCabinRetreat />} />
              <Route path="/bansko-remote-work-retreat" element={<BanskoRemoteWorkRetreat />} />
              <Route path="/bg/bansko-remote-work-retreat" element={<BanskoRemoteWorkRetreat />} />
              <Route path="/retreat-venue-bulgaria" element={<RetreatVenueBulgaria />} />
              <Route path="/bg/retreat-venue-bulgaria" element={<RetreatVenueBulgaria />} />
              <Route path="/off-grid-stays-bulgaria" element={<OffGridStaysBulgaria />} />
              <Route path="/bg/off-grid-stays-bulgaria" element={<OffGridStaysBulgaria />} />

              {/* Booking state only where useBookingContext is required */}
              <Route element={<BookingProviderLayout />}>
                <Route path="/search" element={<SearchResults />} />
                <Route path="/bg/search" element={<SearchResults />} />
                <Route path="/cabin/:id/confirm" element={<ConfirmBooking />} />
                <Route path="/bg/cabin/:id/confirm" element={<ConfirmBooking />} />
                <Route path="/cabin/:id" element={<CabinDetails />} />
                <Route path="/bg/cabin/:id" element={<CabinDetails />} />
                <Route path="/craft/step-1" element={<Step1TripType />} />
                <Route path="/craft/step-2" element={<Step2ArrivalMethod />} />
                <Route path="/craft/step-3" element={<Step3GuestDetails />} />
                <Route path="/craft/step-4" element={<Step4Summary />} />
              </Route>
            </Route>

            {/* Admin layout */}
            <Route element={<AdminLayout />}>
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/bookings" element={<Navigate to="/ops/reservations" replace />} />
              <Route path="/admin/bookings/:id" element={<AdminBookingDetailRedirect />} />
              <Route path="/admin/cabins" element={<CabinsList />} />
              <Route path="/admin/cabins/new" element={<CabinEdit />} />
              <Route path="/admin/cabins/:id" element={<CabinEdit />} />
              <Route path="/admin/cabin-types" element={<CabinTypesList />} />
              <Route path="/admin/cabin-types/:id" element={<CabinTypeEdit />} />
              <Route path="/admin/reviews" element={<ReviewsList />} />
              <Route path="/admin/reviews/:id" element={<ReviewEdit />} />
              <Route path="/admin/promo-codes" element={<PromoCodesList />} />
            </Route>

            {/* Embedded layout */}
            <Route element={<EmbeddedLayout />}>
              <Route
                path="/embedded/craft"
                element={
                  <BookingProvider>
                    <CraftEmbedded />
                  </BookingProvider>
                }
              />
            </Route>

            {/* Ops layout */}
            <Route element={<OpsLayout />}>
              <Route path="/ops" element={<OpsDashboard />} />
              <Route path="/ops/calendar" element={<OpsCalendarIndex />} />
              <Route path="/ops/calendar/:cabinId" element={<OpsCalendarMonth />} />
              <Route path="/ops/reservations" element={<OpsReservations />} />
              <Route path="/ops/reservations/:id" element={<OpsReservationDetail />} />
              <Route path="/ops/payments" element={<OpsPayments />} />
              <Route path="/ops/sync" element={<OpsSyncCenter />} />
              <Route path="/ops/cabins" element={<OpsCabinsList />} />
              <Route path="/ops/cabins/:id" element={<OpsCabinsDetail />} />
              <Route path="/ops/reviews" element={<OpsReviews />} />
              <Route path="/ops/communications" element={<OpsCommunicationOversight />} />
              <Route path="/ops/manual-review" element={<OpsManualReviewBacklog />} />
            <Route path="/ops/readiness" element={<OpsReadiness />} />
            </Route>

            <Route element={<MaintenanceLayout />}>
              <Route path="/maintenance" element={<MaintenanceHome />} />
              <Route path="/maintenance/cabins" element={<MaintenanceCabins />} />
              <Route path="/maintenance/reservations" element={<MaintenanceReservations />} />
              <Route path="/maintenance/sync" element={<MaintenanceSync />} />
              <Route path="/maintenance/cleanup" element={<MaintenanceCleanup />} />
              <Route path="/maintenance/archived" element={<MaintenanceArchived />} />
            </Route>

            {/* Not found layout */}
            <Route element={<NotFoundLayout />}>
              <Route path="/bg/*" element={<NotFoundPage />} />
              <Route path="/nl/*" element={<NotFoundPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
        </Routes>
      </Suspense>
    </>
  )
}

export default App
