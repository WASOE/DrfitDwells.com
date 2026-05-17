import { describe, expect, it, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BookingSuccess from './BookingSuccess';

vi.mock('../services/api', () => ({
  bookingAPI: {
    getConfirmation: vi.fn(),
    postPurchaseTracking: vi.fn(() => Promise.resolve({ data: {} }))
  }
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      const map = {
        'success.seoLoadingTitle': 'Loading',
        'success.seoLoadingDescription': 'Loading desc',
        'success.loadingBody': 'Loading body',
        'success.seoConfirmedTitle': `Confirmed ${opts?.cabinName || ''}`,
        'success.seoConfirmedDescription': 'Confirmed desc',
        'success.heroTitle': 'Booked',
        'success.heroSubtitle': 'Thanks',
        'success.bookingRef': `Ref ${opts?.ref}`,
        'success.summaryTitle': 'Summary',
        'success.cabinLabel': 'Stay',
        'fields.checkIn': 'Check-in',
        'fields.checkOut': 'Check-out',
        'success.durationLabel': 'Duration',
        'modal.nights': `${opts?.count} nights`,
        'success.tripTypeLabel': 'Trip',
        'success.tripTypes.custom': 'Custom',
        'success.primaryGuestLabel': 'Guest',
        'success.guestsSummaryLabel': 'Guests',
        'success.adultsCount': `${opts?.count} adults`,
        'success.preArrivalTitle': 'Pre-arrival',
        'success.packingSafetyTitle': 'Packing',
        'success.addToCalendar': 'Calendar',
        'success.whatsappGroup': 'WhatsApp',
        'success.totalCostTitle': 'Total',
        'success.paymentPaidOnline': 'Paid online',
        'success.paymentPendingOnArrival': 'Payment due on arrival',
        'success.paymentCoveredByVoucher': 'Covered by voucher',
        'success.paymentCardAndVoucher': `€${opts?.voucherAmount} voucher · €${opts?.cardAmount} card`,
        'success.quoteBody': 'Quote',
        'success.quoteFooter': 'Footer',
        'success.needHelpTitle': 'Help',
        'success.backToHome': 'Home',
        'success.exploreMoreStays': 'Explore',
        'success.footerNoteLine1': 'Note1',
        'success.footerNoteLine2': 'Note2'
      };
      return map[key] || key;
    },
    i18n: { language: 'en' }
  })
}));

vi.mock('../hooks/useSiteLanguage', () => ({
  useSiteLanguage: () => ({ language: 'en' })
}));

vi.mock('../components/Seo', () => ({
  default: ({ children }) => children || null
}));

vi.mock('../tracking/consent', () => ({
  readConsentChoice: () => null
}));

vi.mock('../tracking/purchase', () => ({
  fireBrowserPurchase: vi.fn()
}));

import { bookingAPI } from '../services/api';

const cabinTypeConfirmation = {
  bookingId: '507f1f77bcf86cd799439011',
  status: 'confirmed',
  bookingRef: 'DW-20260601-011',
  checkInDateOnly: '2026-06-10',
  checkOutDateOnly: '2026-06-12',
  displayEntity: {
    type: 'cabinType',
    name: 'A-Frame',
    location: 'Bansko',
    meetingPoint: null,
    packingList: [],
    arrivalGuideUrl: null,
    safetyNotes: null,
    emergencyContact: null,
    arrivalWindowDefault: null
  },
  unitLabel: null,
  paymentSummary: {
    paid: true,
    method: 'stripe',
    displayAmount: 240,
    copyKey: 'success.paymentPaidOnline',
    cardPaidAmount: 240,
    voucherAppliedAmount: null
  },
  guest: { firstName: 'I', lastName: 'R', email: 'g@example.com' },
  adults: 2,
  children: 0,
  totalNights: 2,
  tripType: null,
  transportMethod: null,
  romanticSetup: false,
  specialRequests: null
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/booking-success/507f1f77bcf86cd799439011']}>
      <Routes>
        <Route path="/booking-success/:id" element={<BookingSuccess />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('BookingSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('renders cabinType-only confirmation without crashing', async () => {
    bookingAPI.getConfirmation.mockResolvedValue({
      data: { success: true, data: { confirmation: cabinTypeConfirmation } }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('A-Frame')).toBeInTheDocument();
      expect(screen.getByText('Paid online')).toBeInTheDocument();
      expect(screen.queryByText('Payment due on arrival')).not.toBeInTheDocument();
    });
  });

  it('shows pending payment copy when unpaid', async () => {
    bookingAPI.getConfirmation.mockResolvedValue({
      data: {
        success: true,
        data: {
          confirmation: {
            ...cabinTypeConfirmation,
            status: 'pending',
            paymentSummary: {
              paid: false,
              method: 'pay_on_arrival',
              displayAmount: 240,
              copyKey: 'success.paymentPendingOnArrival'
            }
          }
        }
      }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Payment due on arrival')).toBeInTheDocument();
    });
  });

  it('renders when display entity is missing fields', async () => {
    bookingAPI.getConfirmation.mockResolvedValue({
      data: {
        success: true,
        data: {
          confirmation: {
            ...cabinTypeConfirmation,
            displayEntity: {
              type: 'unknown',
              name: 'Your stay',
              location: '',
              meetingPoint: null,
              packingList: [],
              arrivalGuideUrl: null,
              safetyNotes: null,
              emergencyContact: null,
              arrivalWindowDefault: null
            }
          }
        }
      }
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Your stay')).toBeInTheDocument();
    });
  });
});
