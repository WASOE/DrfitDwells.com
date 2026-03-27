import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.K6_BASE_URL || 'https://driftdwells.com';

export const options = {
  stages: [
    { duration: '1m', target: Number(__ENV.K6_AVG_RAMP_VUS || 10) },
    { duration: '3m', target: Number(__ENV.K6_AVG_STEADY_VUS || 20) },
    { duration: '1m', target: 0 }
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000']
  }
};

export default function () {
  const routes = [
    '/',
    '/cabin',
    '/valley',
    '/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0'
  ];

  const route = routes[Math.floor(Math.random() * routes.length)];
  const pageRes = http.get(`${BASE_URL}${route}`);
  check(pageRes, { 'page request status acceptable': (r) => r.status === 200 });

  const availRes = http.get(
    `${BASE_URL}/api/availability?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0`
  );
  check(availRes, { 'availability status acceptable': (r) => r.status === 200 || r.status === 400 });

  sleep(0.5);
}
