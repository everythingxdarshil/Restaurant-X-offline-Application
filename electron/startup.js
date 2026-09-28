const status = document.getElementById('status');
const actions = document.getElementById('actions');
const retry = document.getElementById('retry');
const logs = document.getElementById('logs');

window.restxDesktop.onRuntimeStatus((update) => {
  status.textContent = update.message;
  actions.hidden = update.state !== 'failed';
});

retry.addEventListener('click', async () => {
  actions.hidden = true;
  status.textContent = 'Restarting local application…';
  try {
    await window.restxDesktop.restartRuntime();
  } catch {
    status.textContent = 'Local Rest-X service could not restart.';
    actions.hidden = false;
  }
});

logs.addEventListener('click', () => window.restxDesktop.openLogs());
