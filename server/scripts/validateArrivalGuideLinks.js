const { isSafeArrivalGuideUrl, resolveGuideUrl, isPdfUrl } = require('../utils/arrivalGuideUrl');

const APP_URL = 'https://driftdwells.com';

const cases = [
  { label: 'relative guide path', input: '/guides/the-valley' },
  { label: 'absolute guide URL', input: 'https://driftdwells.com/guides/the-valley/a-frame' },
  { label: 'PDF URL', input: 'https://cdn.example.com/guides/arrival.pdf' },
  { label: 'PDF URL with query', input: 'https://cdn.example.com/guides/arrival.pdf?download=1' },
  { label: 'missing guide', input: '' }
];

for (const testCase of cases) {
  const safe = isSafeArrivalGuideUrl(testCase.input);
  const href = resolveGuideUrl(testCase.input, APP_URL);
  const cta = !testCase.input
    ? 'none'
    : (isPdfUrl(testCase.input) ? 'Download PDF Guide' : 'Open Arrival Guide');

  console.log(
    JSON.stringify({
      case: testCase.label,
      input: testCase.input,
      safe,
      href,
      cta
    })
  );
}
