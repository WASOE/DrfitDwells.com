import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OpsSessionProvider } from '../../context/OpsSessionContext';
import { OpsAppearanceProvider } from '../../ops/appearance/OpsAppearanceProvider';
import OpsBuildEnquiryDetail from './OpsBuildEnquiryDetail';

vi.mock('../../services/opsApi', () => ({
  opsReadAPI: {
    buildEnquiryDetail: vi.fn()
  },
  opsWriteAPI: {
    patchBuildEnquiryStatus: vi.fn()
  }
}));

import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const adminSession = {
  authenticated: true,
  actorId: 'admin-1',
  role: 'admin',
  modules: ['*'],
  actions: [],
  defaultRoute: '/ops',
  locale: 'en'
};

function detail(overrides = {}) {
  return {
    id: 'be-1',
    projectReference: 'BD-20261026-ABCDEF123456',
    status: 'new',
    createdAt: '2026-10-26T10:00:00.000Z',
    updatedAt: '2026-10-26T10:00:00.000Z',
    contact: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+359888' },
    project: {
      location: 'Near Bansko',
      landStatus: 'owned',
      budget: '30k_50k',
      timeline: 'within_6_months',
      message: 'Looking for a Lux Cabin'
    },
    config: {
      modelId: 'lux-cabin',
      modelLabel: 'The Lux Cabin',
      customDimensions: null,
      radio: { cladding: 'cladding-thermal-wood' },
      radioLabels: { cladding: 'Thermal wood' },
      toggles: ['extra-solar'],
      toggleLabels: ['Extra solar']
    },
    configMeta: { currentStep: 2, stepsVisited: [0, 1, 2], isPartial: true },
    estimate: { displayLabel: '€39,200', totalEur: 39200, hasConsultationItems: false, unverified: true },
    attribution: { utmSource: 'instagram', utmMedium: 'social', campaign: null, referrer: null },
    emails: {
      internal: { status: 'succeeded', attemptCount: 1, maxAttempts: 10, nextAttemptAt: null },
      customer: { status: 'succeeded', attemptCount: 1, maxAttempts: 10, nextAttemptAt: null },
      attention: { hasNeedsManual: false, hasFailed: false, hasPending: false }
    },
    ...overrides
  };
}

function renderDetail(id = 'be-1') {
  return render(
    <MemoryRouter initialEntries={[`/ops/build-enquiries/${id}`]}>
      <OpsAppearanceProvider>
        <OpsSessionProvider session={adminSession}>
          <Routes>
            <Route path="/ops/build-enquiries/:id" element={<OpsBuildEnquiryDetail />} />
          </Routes>
        </OpsSessionProvider>
      </OpsAppearanceProvider>
    </MemoryRouter>
  );
}

describe('OpsBuildEnquiryDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsReadAPI.buildEnquiryDetail.mockResolvedValue({ data: { data: detail() } });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders contact, config, project, estimate, attribution and email lanes', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('ops-build-enquiry-detail')).toBeInTheDocument();
    });
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Near Bansko')).toBeInTheDocument();
    expect(screen.getByText('The Lux Cabin')).toBeInTheDocument();
    expect(screen.getByText('€39,200')).toBeInTheDocument();
    expect(screen.getByText('instagram')).toBeInTheDocument();
    expect(screen.getByTestId('ops-be-email-internal')).toBeInTheDocument();
    expect(screen.getByTestId('ops-be-email-customer')).toBeInTheDocument();
  });

  it('highlights needs_manual email delivery', async () => {
    opsReadAPI.buildEnquiryDetail.mockResolvedValue({
      data: {
        data: detail({
          emails: {
            internal: { status: 'needs_manual', attemptCount: 10, maxAttempts: 10, nextAttemptAt: null },
            customer: { status: 'succeeded', attemptCount: 1, maxAttempts: 10, nextAttemptAt: null },
            attention: { hasNeedsManual: true, hasFailed: false, hasPending: false }
          }
        })
      }
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText(/need manual intervention/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Needs manual')).toBeInTheDocument();
    expect(screen.getByTestId('ops-be-email-internal')).toHaveClass('ops-be-email-lane--alert');
  });

  it('highlights failed email delivery', async () => {
    opsReadAPI.buildEnquiryDetail.mockResolvedValue({
      data: {
        data: detail({
          emails: {
            internal: { status: 'succeeded', attemptCount: 1, maxAttempts: 10, nextAttemptAt: null },
            customer: { status: 'failed', attemptCount: 2, maxAttempts: 10, nextAttemptAt: null },
            attention: { hasNeedsManual: false, hasFailed: true, hasPending: false }
          }
        })
      }
    });
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText(/email deliveries failed/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByTestId('ops-be-email-customer')).toHaveClass('ops-be-email-lane--alert');
  });

  it('updates status via PATCH', async () => {
    opsWriteAPI.patchBuildEnquiryStatus.mockResolvedValue({
      data: { data: detail({ status: 'in_progress' }) }
    });
    renderDetail();
    await screen.findByTestId('ops-build-enquiry-detail');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'in_progress' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update status' }));
    await waitFor(() => {
      expect(opsWriteAPI.patchBuildEnquiryStatus).toHaveBeenCalledWith('be-1', 'in_progress');
    });
  });
});
