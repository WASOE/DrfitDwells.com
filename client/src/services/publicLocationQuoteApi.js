import api from './api';

export const publicLocationQuoteAPI = {
  /**
   * @param {string} locationSlug - e.g. 'the-valley'
   * @param {{ checkIn: string, checkOut: string, adults: number, children?: number }} payload
   */
  async getQuote(locationSlug, payload) {
    const response = await api.post(`/public/location-quotes/${locationSlug}`, payload);
    return response.data;
  },

  /**
   * @param {object} payload
   */
  async submitEnquiry(payload) {
    const response = await api.post('/public/location-enquiries', payload);
    return response.data;
  }
};

export default publicLocationQuoteAPI;
