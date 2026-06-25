import { useState } from 'react';
import { opsWriteAPI } from '../../services/opsApi';

export default function ManualReviewResolveAction({ manualReviewItemId, onResolved, className = '' }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!manualReviewItemId) return null;

  const reset = () => {
    setOpen(false);
    setNote('');
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      setError('Add a short resolution note (at least 3 characters).');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const resp = await opsWriteAPI.resolveManualReviewItem(manualReviewItemId, { note: trimmed });
      if (!resp.data?.success) {
        throw new Error(resp.data?.message || 'Failed to resolve item');
      }
      reset();
      if (typeof onResolved === 'function') onResolved(resp.data?.data?.item || null);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to resolve item');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={`text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-800 ${className}`.trim()}
      >
        Resolve
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      onClick={(event) => event.stopPropagation()}
      className={`mt-2 space-y-2 max-w-md ${className}`.trim()}
    >
      <label className="block text-xs text-gray-600">
        Resolution note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="What was done to handle this?"
          className="mt-1 w-full text-sm border border-gray-300 rounded-md px-2 py-1.5"
          disabled={submitting}
        />
      </label>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-2.5 py-1 rounded bg-[#81887A] text-white hover:bg-[#707668] disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Confirm resolve'}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            reset();
          }}
          className="text-xs px-2.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
