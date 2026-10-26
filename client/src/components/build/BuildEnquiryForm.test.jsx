import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInitialBuildState } from '../../data/buildConfiguratorLogic.js';
import { BUILD_ENQUIRY_PRIMARY_CTA } from '../../data/buildEnquiryConstants.js';
import { BUILD_CONSULTATION_URL } from '../../data/buildConsultation.js';
import BuildEnquiryForm from './BuildEnquiryForm.jsx';
import BuildStickyBar from './BuildStickyBar.jsx';
import BuildSummary from './BuildSummary.jsx';
import { getBuildModel } from '../../data/buildConfiguratorSchema.js';

vi.mock('../../services/buildEnquiryApi.js', () => ({
  submitBuildEnquiry: vi.fn(),
  mapBuildEnquirySubmitError: vi.fn((error) => {
    const status = error?.response?.status;
    if (status === 429) {
      return { type: 'rate_limit', message: 'Too many enquiry submissions. Please try again later.' };
    }
    if (status === 503) {
      return { type: 'unavailable', message: 'Could not save enquiry. Please try again shortly.' };
    }
    if (status === 400) {
      return { type: 'validation', message: 'Invalid build enquiry', errors: [] };
    }
    if (!error?.response) {
      return { type: 'network', message: 'Network error. Check your connection and try again.' };
    }
    return { type: 'unknown', message: 'Something went wrong. Please try again.' };
  })
}));

vi.mock('../../data/buildEnquiryPayload.js', async () => {
  const actual = await vi.importActual('../../data/buildEnquiryPayload.js');
  return {
    ...actual,
    makeBuildEnquiryIdempotencyKey: vi.fn(() => 'be_fixed_key_for_tests')
  };
});

import { submitBuildEnquiry } from '../../services/buildEnquiryApi.js';
import { makeBuildEnquiryIdempotencyKey } from '../../data/buildEnquiryPayload.js';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText(/Project location/), {
    target: { value: 'Near Bansko' }
  });
  fireEvent.change(screen.getByLabelText(/Land status/), { target: { value: 'owned' } });
  fireEvent.change(screen.getByLabelText(/^Budget/), { target: { value: '30k_50k' } });
  fireEvent.change(screen.getByLabelText(/^Timeline/), { target: { value: 'within_6_months' } });
}

describe('BuildEnquiryForm', () => {
  const state = createInitialBuildState('lux-cabin');

  beforeEach(() => {
    vi.clearAllMocks();
    makeBuildEnquiryIdempotencyKey.mockReturnValue('be_fixed_key_for_tests');
    submitBuildEnquiry.mockResolvedValue({
      projectReference: 'BD-20261026-ABCDEF123456',
      enquiryId: 'enq1',
      duplicate: false,
      status: 201
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('submits complete config payload and shows success with consultation CTA', async () => {
    render(
      <BuildEnquiryForm
        open
        onClose={vi.fn()}
        configuratorState={state}
        currentStep={4}
        onDownloadPDF={vi.fn()}
      />
    );

    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));

    await waitFor(() => {
      expect(submitBuildEnquiry).toHaveBeenCalledTimes(1);
    });

    const payload = submitBuildEnquiry.mock.calls[0][0];
    expect(payload.idempotencyKey).toBe('be_fixed_key_for_tests');
    expect(payload.contact.email).toBe('ada@example.com');
    expect(payload.config.modelId).toBe('lux-cabin');
    expect(payload.configMeta.isPartial).toBe(false);
    expect(payload.estimate.totalEur).toBeTypeOf('number');

    expect(await screen.findByTestId('build-enquiry-project-reference')).toHaveTextContent(
      'BD-20261026-ABCDEF123456'
    );
    const consult = screen.getByTestId('build-enquiry-consultation-cta');
    expect(consult).toHaveAttribute('href', BUILD_CONSULTATION_URL);
    expect(screen.getByText(/enquiry was saved successfully/i)).toBeInTheDocument();
    expect(screen.queryByText(/we (have )?emailed/i)).not.toBeInTheDocument();
  });

  it('submits partial early-step configuration', async () => {
    const partial = { ...state, radio: {}, toggles: [] };
    render(
      <BuildEnquiryForm
        open
        onClose={vi.fn()}
        configuratorState={partial}
        currentStep={1}
        onDownloadPDF={vi.fn()}
      />
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    await waitFor(() => expect(submitBuildEnquiry).toHaveBeenCalled());
    expect(submitBuildEnquiry.mock.calls[0][0].configMeta.isPartial).toBe(true);
    expect(submitBuildEnquiry.mock.calls[0][0].configMeta.currentStep).toBe(1);
  });

  it('blocks double submit and reuses idempotency key across retries', async () => {
    let resolveSubmit;
    submitBuildEnquiry.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(
      <BuildEnquiryForm
        open
        onClose={vi.fn()}
        configuratorState={state}
        currentStep={2}
        onDownloadPDF={vi.fn()}
      />
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));

    await waitFor(() => expect(submitBuildEnquiry).toHaveBeenCalledTimes(1));

    resolveSubmit({
      projectReference: 'BD-RETRY',
      enquiryId: 'e2',
      duplicate: false,
      status: 201
    });
    await screen.findByTestId('build-enquiry-success');
  });

  it('keeps the same idempotency key after a network failure retry', async () => {
    submitBuildEnquiry
      .mockRejectedValueOnce({ message: 'network' })
      .mockResolvedValueOnce({
        projectReference: 'BD-AFTER-RETRY',
        enquiryId: 'e3',
        duplicate: false,
        status: 201
      });

    render(
      <BuildEnquiryForm
        open
        onClose={vi.fn()}
        configuratorState={state}
        currentStep={2}
        onDownloadPDF={vi.fn()}
      />
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    await screen.findByText(/Network error/i);
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    await screen.findByText('BD-AFTER-RETRY');
    expect(submitBuildEnquiry.mock.calls[0][0].idempotencyKey).toBe('be_fixed_key_for_tests');
    expect(submitBuildEnquiry.mock.calls[1][0].idempotencyKey).toBe('be_fixed_key_for_tests');
  });

  it('shows validation, 429 and 503 errors', async () => {
    render(
      <BuildEnquiryForm
        open
        onClose={vi.fn()}
        configuratorState={state}
        currentStep={0}
        onDownloadPDF={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    expect(await screen.findByText(/fix the highlighted fields/i)).toBeInTheDocument();
    expect(submitBuildEnquiry).not.toHaveBeenCalled();

    cleanup();
    submitBuildEnquiry.mockRejectedValueOnce({ response: { status: 429, data: {} } });
    render(
      <BuildEnquiryForm open onClose={vi.fn()} configuratorState={state} currentStep={0} />
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    expect(await screen.findByText(/Too many enquiry submissions/i)).toBeInTheDocument();
    expect(screen.queryByTestId('build-enquiry-consultation-cta')).not.toBeInTheDocument();

    cleanup();
    submitBuildEnquiry.mockRejectedValueOnce({ response: { status: 503, data: {} } });
    render(
      <BuildEnquiryForm open onClose={vi.fn()} configuratorState={state} currentStep={0} />
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    expect(await screen.findByText(/Could not save enquiry/i)).toBeInTheDocument();
  });

  it('mints a new idempotency key for a genuinely new enquiry after success', async () => {
    makeBuildEnquiryIdempotencyKey
      .mockReturnValueOnce('be_first')
      .mockReturnValueOnce('be_second');

    render(
      <BuildEnquiryForm
        open
        onClose={vi.fn()}
        configuratorState={state}
        currentStep={3}
        onDownloadPDF={vi.fn()}
      />
    );
    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    await screen.findByTestId('build-enquiry-success');
    fireEvent.click(screen.getByRole('button', { name: /New enquiry/i }));
    fillValidForm();
    fireEvent.click(screen.getByTestId('build-enquiry-submit'));
    await waitFor(() => expect(submitBuildEnquiry).toHaveBeenCalledTimes(2));
    expect(submitBuildEnquiry.mock.calls[0][0].idempotencyKey).toBe('be_first');
    expect(submitBuildEnquiry.mock.calls[1][0].idempotencyKey).toBe('be_second');
  });
});

describe('Build enquiry CTAs', () => {
  it('uses Get my project estimate on desktop sticky bar and summary', () => {
    const onOpen = vi.fn();
    render(
      <BuildStickyBar
        dimensions="6×3"
        area="18 m²"
        capacity="2"
        price="€32,000"
        onDownloadPDF={vi.fn()}
        onOpenEnquiry={onOpen}
      />
    );
    fireEvent.click(screen.getByTestId('build-enquiry-cta-desktop'));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByTestId('build-enquiry-cta-desktop')).toHaveTextContent(
      BUILD_ENQUIRY_PRIMARY_CTA
    );
    cleanup();

    const state = createInitialBuildState();
    render(
      <BuildSummary
        state={state}
        model={getBuildModel(state.modelId)}
        onDownloadPDF={vi.fn()}
        onOpenEnquiry={onOpen}
      />
    );
    expect(screen.getByTestId('build-enquiry-cta-summary')).toHaveTextContent(
      BUILD_ENQUIRY_PRIMARY_CTA
    );
    expect(screen.queryByRole('link', { name: /consultation/i })).not.toBeInTheDocument();
  });
});
