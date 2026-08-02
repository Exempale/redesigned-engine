(() => {
  'use strict';

  const HEARTBEAT_INTERVAL = 25_000;
  const clientIdKey = 'fortport-online-client-id';
  let clientId = sessionStorage.getItem(clientIdKey);

  if (!clientId) {
    clientId = (window.crypto?.randomUUID?.()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(clientIdKey, clientId);
  }

  function setCounter(count) {
    const value = document.getElementById('online-users-count');
    if (value && Number.isInteger(count)) value.textContent = String(count);
  }

  async function heartbeat() {
    try {
      const response = await fetch('/api/online/heartbeat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId })
      });

      // Guests are intentionally not included: the counter shows signed-in users.
      if (response.ok) {
        const data = await response.json();
        setCounter(data.online);
      }
    } catch (_) {
      // A temporary connection failure must not affect the rest of the page.
    }
  }

  async function refreshCounter() {
    try {
      const response = await fetch('/api/online', { credentials: 'same-origin' });
      if (response.ok) {
        const data = await response.json();
        setCounter(data.online);
      }
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const widget = document.createElement('div');
    widget.className = 'online-users-widget';
    widget.setAttribute('role', 'status');
    widget.setAttribute('aria-live', 'polite');
    widget.innerHTML = '<span class="online-users-dot" aria-hidden="true"></span><span>Сейчас в сети: <strong id="online-users-count">—</strong></span>';
    document.body.appendChild(widget);

    heartbeat();
    refreshCounter();
    window.setInterval(heartbeat, HEARTBEAT_INTERVAL);
    window.setInterval(refreshCounter, HEARTBEAT_INTERVAL);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') heartbeat();
    });
  });
})();
