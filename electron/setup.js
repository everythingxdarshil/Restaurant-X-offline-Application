const byId = (id) => document.getElementById(id);
const form = byId('server-form');
const errorBox = byId('error');

function showError(message = '') {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function errorMessage(failure) {
  return String(failure?.message || 'Request failed.').replace(/^Error invoking remote method '[^']+': Error: /, '');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Setting up terminal…';
  try {
    if (!window.restxDesktop?.activateTerminal) {
      throw new Error('Desktop connection unavailable. Close this page and open Rest-X application.');
    }
    await window.restxDesktop.activateTerminal({
      serverUrl: byId('server-url').value,
      code: byId('restaurant-code').value,
    });
  } catch (failure) {
    showError(errorMessage(failure));
    button.disabled = false;
    button.textContent = 'Set up terminal';
  }
});
