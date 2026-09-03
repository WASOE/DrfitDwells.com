import api from './api';

/** Cookie session for creator portal; explicit credentials for cross-origin safety. */
const cred = { withCredentials: true };

export const creatorPortalAPI = {
  session: () => api.get('/creator-portal/session', cred),
  me: () => api.get('/creator-portal/me', cred),
  logout: () => api.post('/creator-portal/logout', {}, cred),
  requestLink: (email) =>
    api.post('/creator-portal/request-link', { email: String(email || '').trim() }, cred),
  updateReferralCode: (code, expectedCurrentCode) =>
    api.patch(
      '/creator-portal/me/referral-code',
      {
        code: String(code || ''),
        // Always send the server snapshot so optimistic concurrency is enforced.
        expectedCurrentCode: String(expectedCurrentCode ?? '')
      },
      cred
    )
};
