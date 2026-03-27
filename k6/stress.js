import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.K6_BASE_URL || 'https://driftdwells.com';

export const options = {
  stages: [
    { duration: '1m', target: Number(__ENV.K6_STRESS_START_VUS || 20) },
    { duration: '2m', target: Number(__ENV.K6_STRESS_PEAK_VUS || 50) },
    { duration: '1m', target: 0 }
  ],
  thresholds: {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<3000']
  }
};

export default function () {
  const endpoints = [
    `${BASE_URL}/`,
    `${BASE_URL}/cabin`,
    `${BASE_URL}/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0`,
    `${BASE_URL}/api/availability?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0`,
    `${BASE_URL}/api/health`
  ];

  const res = http.get(endpoints[Math.floor(Math.random() * endpoints.length)]);
  check(res, {
    'stress request status acceptable': (r) => r.status >= 200 && r.status < 500
  });

  sleep(0.3);
}
