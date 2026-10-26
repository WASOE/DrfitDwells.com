import { useEffect, useId, useRef, useState } from 'react';
import {
  BUILD_BUDGET_OPTIONS,
  BUILD_LAND_STATUS_OPTIONS,
  BUILD_TIMELINE_OPTIONS
} from '../../data/buildEnquiryConstants.js';
import {
  buildBuildEnquiryPayload,
  makeBuildEnquiryIdempotencyKey,
  validateBuildEnquiryForm
} from '../../data/buildEnquiryPayload.js';
import {
  mapBuildEnquirySubmitError,
  submitBuildEnquiry
} from '../../services/buildEnquiryApi.js';
import BuildEnquirySuccess from './BuildEnquirySuccess.jsx';

const EMPTY_CONTACT = { name: '', email: '', phone: '' };
const EMPTY_PROJECT = {
  location: '',
  landStatus: '',
  budget: '',
  timeline: '',
  message: ''
};

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-[0.72rem] text-[#b42318]" role="alert">
      {message}
    </p>
  );
}

const BuildEnquiryForm = ({
  open,
  onClose,
  configuratorState,
  currentStep = 0,
  stepsVisited,
  onDownloadPDF
}) => {
  const titleId = useId();
  const idempotencyKeyRef = useRef(null);
  const submittingRef = useRef(false);

  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [project, setProject] = useState(EMPTY_PROJECT);
  const [website, setWebsite] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    idempotencyKeyRef.current = makeBuildEnquiryIdempotencyKey();
    submittingRef.current = false;
    setContact(EMPTY_CONTACT);
    setProject(EMPTY_PROJECT);
    setWebsite('');
    setFieldErrors({});
    setFormError('');
    setSubmitting(false);
    setSuccess(null);

    const onKey = (event) => {
      if (event.key === 'Escape' && !submittingRef.current) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const startAnother = () => {
    idempotencyKeyRef.current = makeBuildEnquiryIdempotencyKey();
    submittingRef.current = false;
    setContact(EMPTY_CONTACT);
    setProject(EMPTY_PROJECT);
    setWebsite('');
    setFieldErrors({});
    setFormError('');
    setSubmitting(false);
    setSuccess(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const local = validateBuildEnquiryForm({ contact, project });
    if (!local.ok) {
      setFieldErrors(local.errors);
      setFormError('Please fix the highlighted fields.');
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = makeBuildEnquiryIdempotencyKey();
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError('');

    const payload = buildBuildEnquiryPayload({
      state: configuratorState,
      currentStep,
      stepsVisited,
      contact,
      project,
      idempotencyKey: idempotencyKeyRef.current,
      website
    });

    try {
      const result = await submitBuildEnquiry(payload);
      setSuccess({
        projectReference: result.projectReference,
        enquiryId: result.enquiryId
      });
    } catch (error) {
      const mapped = mapBuildEnquirySubmitError(error);
      setFormError(mapped.message);
      // Keep idempotency key so network retries / double-clicks reuse the same enquiry.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submittingRef.current) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={success ? 'build-enquiry-success-title' : titleId}
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-[2px]"
        data-testid="build-enquiry-dialog"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#e0e0e0] px-5 py-4 sm:px-6">
          <div>
            <p className="mb-1 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[#9a9a9a]">
              Project enquiry
            </p>
            <h2
              id={titleId}
              className="font-serif text-xl font-normal text-[#1a1a1a] sm:text-2xl"
            >
              {success ? 'Enquiry received' : 'Get your project estimate'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f3] text-[#5a5a5a] disabled:opacity-50"
            aria-label="Close enquiry form"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {success ? (
            <BuildEnquirySuccess
              projectReference={success.projectReference}
              onDownloadPDF={onDownloadPDF}
              onClose={onClose}
              onStartAnother={startAnother}
            />
          ) : (
            <form onSubmit={handleSubmit} noValidate data-testid="build-enquiry-form">
              <p className="mb-5 text-[0.82rem] leading-relaxed text-[#5a5a5a]">
                Share a few project details and we&apos;ll save your current cabin configuration —
                even if you haven&apos;t finished every step.
              </p>

              <div className="mb-4">
                <label htmlFor="be-name" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                  Name
                </label>
                <input
                  id="be-name"
                  name="name"
                  autoComplete="name"
                  value={contact.name}
                  onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                  className="w-full rounded-[2px] border border-[#e0e0e0] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'be-name-error' : undefined}
                />
                <FieldError id="be-name-error" message={fieldErrors.name} />
              </div>

              <div className="mb-4">
                <label htmlFor="be-email" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                  Email
                </label>
                <input
                  id="be-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={contact.email}
                  onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  className="w-full rounded-[2px] border border-[#e0e0e0] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? 'be-email-error' : undefined}
                />
                <FieldError id="be-email-error" message={fieldErrors.email} />
              </div>

              <div className="mb-4">
                <label htmlFor="be-phone" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                  Phone <span className="normal-case tracking-normal text-[#b5b5b5]">(optional)</span>
                </label>
                <input
                  id="be-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={contact.phone}
                  onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  className="w-full rounded-[2px] border border-[#e0e0e0] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                  aria-invalid={Boolean(fieldErrors.phone)}
                  aria-describedby={fieldErrors.phone ? 'be-phone-error' : undefined}
                />
                <FieldError id="be-phone-error" message={fieldErrors.phone} />
              </div>

              <div className="mb-4">
                <label htmlFor="be-location" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                  Project location
                </label>
                <input
                  id="be-location"
                  name="location"
                  value={project.location}
                  onChange={(e) => setProject((p) => ({ ...p, location: e.target.value }))}
                  placeholder="e.g. Near Bansko, Bulgaria"
                  className="w-full rounded-[2px] border border-[#e0e0e0] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                  aria-invalid={Boolean(fieldErrors.location)}
                  aria-describedby={fieldErrors.location ? 'be-location-error' : undefined}
                />
                <FieldError id="be-location-error" message={fieldErrors.location} />
              </div>

              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="be-land" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                    Land status
                  </label>
                  <select
                    id="be-land"
                    name="landStatus"
                    value={project.landStatus}
                    onChange={(e) => setProject((p) => ({ ...p, landStatus: e.target.value }))}
                    className="w-full rounded-[2px] border border-[#e0e0e0] bg-white px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                    aria-invalid={Boolean(fieldErrors.landStatus)}
                    aria-describedby={fieldErrors.landStatus ? 'be-land-error' : undefined}
                  >
                    <option value="">Select…</option>
                    {BUILD_LAND_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <FieldError id="be-land-error" message={fieldErrors.landStatus} />
                </div>
                <div>
                  <label htmlFor="be-budget" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                    Budget
                  </label>
                  <select
                    id="be-budget"
                    name="budget"
                    value={project.budget}
                    onChange={(e) => setProject((p) => ({ ...p, budget: e.target.value }))}
                    className="w-full rounded-[2px] border border-[#e0e0e0] bg-white px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                    aria-invalid={Boolean(fieldErrors.budget)}
                    aria-describedby={fieldErrors.budget ? 'be-budget-error' : undefined}
                  >
                    <option value="">Select…</option>
                    {BUILD_BUDGET_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <FieldError id="be-budget-error" message={fieldErrors.budget} />
                </div>
              </div>

              <div className="mb-4">
                <label htmlFor="be-timeline" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                  Timeline
                </label>
                <select
                  id="be-timeline"
                  name="timeline"
                  value={project.timeline}
                  onChange={(e) => setProject((p) => ({ ...p, timeline: e.target.value }))}
                  className="w-full rounded-[2px] border border-[#e0e0e0] bg-white px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                  aria-invalid={Boolean(fieldErrors.timeline)}
                  aria-describedby={fieldErrors.timeline ? 'be-timeline-error' : undefined}
                >
                  <option value="">Select…</option>
                  {BUILD_TIMELINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <FieldError id="be-timeline-error" message={fieldErrors.timeline} />
              </div>

              <div className="mb-4">
                <label htmlFor="be-message" className="mb-1.5 block text-[0.68rem] uppercase tracking-[0.1em] text-[#9a9a9a]">
                  Message <span className="normal-case tracking-normal text-[#b5b5b5]">(optional)</span>
                </label>
                <textarea
                  id="be-message"
                  name="message"
                  rows={4}
                  value={project.message}
                  onChange={(e) => setProject((p) => ({ ...p, message: e.target.value }))}
                  className="w-full resize-y rounded-[2px] border border-[#e0e0e0] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none focus:border-[#1a1a1a]"
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={fieldErrors.message ? 'be-message-error' : undefined}
                />
                <FieldError id="be-message-error" message={fieldErrors.message} />
              </div>

              {/* Honeypot — leave empty */}
              <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
                <label htmlFor="be-website">Website</label>
                <input
                  id="be-website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {formError ? (
                <p className="mb-4 rounded-[2px] bg-[#fef3f2] px-3 py-2 text-[0.78rem] text-[#b42318]" role="alert">
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-[2px] bg-[#1a1a1a] px-4 py-4 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="build-enquiry-submit"
              >
                {submitting ? 'Saving enquiry…' : 'Submit enquiry'}
              </button>

              {onDownloadPDF ? (
                <button
                  type="button"
                  onClick={onDownloadPDF}
                  className="mt-3 w-full rounded-[2px] border border-[#e0e0e0] px-4 py-3 text-[0.68rem] uppercase tracking-[0.1em] text-[#5a5a5a] transition-colors hover:border-[#1a1a1a]"
                >
                  Download spec PDF
                </button>
              ) : null}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default BuildEnquiryForm;
