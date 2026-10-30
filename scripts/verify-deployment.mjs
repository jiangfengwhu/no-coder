const { APP_URL, EXPECTED_COMMIT } = process.env;
if (!APP_URL || !EXPECTED_COMMIT) throw new Error('Configure repository variable APP_URL and EXPECTED_COMMIT.');
const url = new URL('/api/health', APP_URL);
if (url.protocol !== 'https:') throw new Error('APP_URL must be an HTTPS URL.');
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
    const body = await response.json();
    if (response.ok && body.ok === true && body.commit === EXPECTED_COMMIT) {
      console.log('Cloudflare health check passed for the expected commit.');
      process.exit(0);
    }
  } catch { /* Retry propagation and transient network errors. */ }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
throw new Error('The live Worker did not serve the expected commit; the queue must stay blocked.');
