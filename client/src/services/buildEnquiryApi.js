import api from './api';

/**
 * POST /api/public/build-enquiries
 * @returns {Promise<{ projectReference: string, enquiryId: string, duplicate: boolean, status: number }>}
 */
export async function submitBuildEnquiry(payload) {
  const response = await api.post('/public/build-enquiries', payload);
  const data = response.data?.data || {};
  return {
    projectReference: data.projectReference,
    enquiryId: data.enquiryId,
    duplicate: Boolean(data.duplicate),
    status: response.status
  };
}

export function mapBuildEnquirySubmitError(error) {
  const status = error?.response?.status;
  const body = error?.response?.data;

  if (status === 400) {
    const serverErrors = Array.isArray(body?.errors) ? body.errors : [];
    return {
      type: 'validation',
      message: body?.message || 'Please check your details and try again.',
      errors: serverErrors
    };
  }
  if (status === 429) {
    return {
      type: 'rate_limit',
      message: body?.message || 'Too many enquiry submissions. Please try again later.'
    };
  }
  if (status === 503) {
    return {
      type: 'unavailable',
      message: body?.message || 'Could not save enquiry. Please try again shortly.'
    };
  }
  if (!error?.response) {
    return {
      type: 'network',
      message: 'Network error. Check your connection and try again.'
    };
  }
  return {
    type: 'unknown',
    message: 'Something went wrong. Please try again.'
  };
}
