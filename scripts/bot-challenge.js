(() => {
  'use strict';

  // Runs silently on login and registration pages. The proof of work is deliberately
  // small: it should complete in a fraction of a second in a normal browser.
  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function verifyBrowser() {
    if (!window.crypto?.subtle) return;
    try {
      const challengeResponse = await fetch('/api/challenge', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!challengeResponse.ok) return;
      const { id, nonce, difficulty } = await challengeResponse.json();
      if (!id || !nonce || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return;

      const prefix = '0'.repeat(difficulty);
      let answer = 0;
      // Yield periodically so the interface never freezes on slower devices.
      while (answer <= 1_000_000) {
        if ((await sha256(`${nonce}:${answer}`)).startsWith(prefix)) break;
        answer++;
        if (answer % 250 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (answer > 1_000_000) return;

      await fetch('/api/challenge/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, answer: String(answer) })
      });
    } catch (_) {
      // A failed background check simply leaves registration/login protected.
    }
  }

  verifyBrowser();
})();
