import api from './api';

/** Cookie session for creator portal; explicit credentials for cross-origin safety. */
const cred = { withCredentials: true };

export const creatorPortalAPI = {
  session: () => api.get('/creator-portal/session', cred),
  me: () => api.get('/creator-portal/me', cred),
  logout: () => api.post('/creator-portal/logout', {}, cred)
};
