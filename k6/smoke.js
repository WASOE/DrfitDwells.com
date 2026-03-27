import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.K6_BASE_URL || 'https://driftdwells.com';

export const options = {
  vus: Number(__ENV.K6_VUS || 1),
  iterations: Number(__ENV.K6_ITERATIONS || 5),
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500']
  }
};

export default function () {
  const pages = ['/', '/cabin', '/valley', '/search?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0'];

  for (const route of pages) {
    const res = http.get(`${BASE_URL}${route}`);
    check(res, {
      [`${route} status is 200`]: (r) => r.status === 200
    });
    sleep(0.2);
  }

  const availability = http.get(
    `${BASE_URL}/api/availability?checkIn=2026-06-15&checkOut=2026-06-17&adults=2&children=0`
  );
  check(availability, {
    'availability endpoint responds': (r) => r.status === 200 || r.status === 400
  });
}
