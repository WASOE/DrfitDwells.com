const { test, expect, request } = require('@playwright/test');
const { getAdminCreds } = require('../helpers/auth');

async function loginViaApi(baseURL) {
  const creds = getAdminCreds();
  test.skip(!creds.username || !creds.password, 'Missing admin credentials for API auth tests');

  const ctx = await request.newContext({ baseURL });
  const response = await ctx.post('/api/admin/login', {
    data: {
      username: creds.username,
      password: creds.password
    }
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.success).toBeTruthy();
  expect(body.token).toBeTruthy();
  await ctx.dispose();
  return body.token;
}

test.describe('api auth and validation', () => {
  test('protected API without token returns unauthorized', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}/api/ops/dashboard`);
    expect(response.status()).toBe(401);
  });

  test('auth failure path returns unauthorized', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/admin/login`, {
      data: { username: 'invalid-user', password: 'invalid-pass' }
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBeFalsy();
  });

  test('protected API with valid token returns success', async ({ request, baseURL }) => {
    const token = await loginViaApi(baseURL);
    const response = await request.get(`${baseURL}/api/admin/bookings`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBeTruthy();
  });

  test('booking API validation rejects invalid payload safely', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/bookings`, {
      data: {}
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success).toBeFalsy();
  });

  test('payment intent API rejects invalid payload safely', async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/bookings/create-payment-intent`, {
      data: {
        checkIn: 'not-a-date',
        checkOut: 'also-not-a-date',
        adults: 0
      }
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success).toBeFalsy();
  });
});
