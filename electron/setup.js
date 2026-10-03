const byId = (id) => document.getElementById(id);
const loadingScreen = byId('loading-screen');
const form = byId('login-form');
const twoFactorForm = byId('two-factor-form');
const scopeForm = byId('scope-form');
const errorBox = byId('error');

function showError(message = '') {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function errorMessage(failure) {
  return String(failure?.message || 'Request failed.').replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function showForm(target) {
  for (const candidate of [loadingScreen, form, twoFactorForm, scopeForm]) candidate.hidden = candidate !== target;
}

function setBusy(target, busy, busyText, readyText) {
  const button = target.querySelector('button[type="submit"]');
  button.disabled = busy;
  button.textContent = busy ? busyText : readyText;
}

function showScopes(scopes) {
  applyBranding(scopes.tenant);
  const branches = scopes.branches ?? [];
  if (!branches.length) throw new Error('No branch is available for this account.');
  byId('branch').replaceChildren(...branches.map((branch) => {
    const option = new Option(branch.name, branch.id);
    option.selected = String(branch.id) === String(scopes.default_scope?.branch_id);
    return option;
  }));
  showForm(scopeForm);
}

function applyBranding(tenant, serverBranding = {}) {
  const branding = tenant?.branding ?? serverBranding;
  const color = String(branding.primary_color ?? '');
  if (/^#[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--brand', color);
  byId('brand-name').textContent = branding.site_name || tenant?.name || 'Offline POS';
  byId('brand-description').textContent = branding.description || 'Fast, secure restaurant operations on this Windows terminal.';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError();
  setBusy(form, true, 'Signing in…', 'Continue');
  try {
    if (!window.restxDesktop?.loginSetup) {
      throw new Error('Desktop connection unavailable. Close this page and open Offline POS application.');
    }
    const result = await window.restxDesktop.loginSetup({
      login: byId('login').value,
      password: byId('password').value,
    });
    byId('password').value = '';
    if (result.requiresTwoFactor) showForm(twoFactorForm);
    else showScopes(result.scopes);
  } catch (failure) {
    showError(errorMessage(failure));
  } finally {
    setBusy(form, false, 'Signing in…', 'Continue');
  }
});

twoFactorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError();
  setBusy(twoFactorForm, true, 'Verifying…', 'Verify');
  try {
    showScopes((await window.restxDesktop.verifySetupTwoFactor(byId('two-factor-code').value)).scopes);
  } catch (failure) {
    showError(errorMessage(failure));
  } finally {
    setBusy(twoFactorForm, false, 'Verifying…', 'Verify');
  }
});

scopeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError();
  setBusy(scopeForm, true, 'Setting up terminal…', 'Set up terminal');
  try {
    await window.restxDesktop.registerTerminal({
      branchId: Number(byId('branch').value),
    });
  } catch (failure) {
    showError(errorMessage(failure));
    setBusy(scopeForm, false, 'Setting up terminal…', 'Set up terminal');
  }
});

async function initializeSetup() {
  showError();
  showForm(loadingScreen);
  byId('retry').hidden = true;
  byId('loading-message').textContent = 'Loading secure sign in from your configured server.';
  try {
    if (!window.restxDesktop?.initializeSetup) throw new Error('Desktop connection unavailable.');
    const result = await window.restxDesktop.initializeSetup();
    applyBranding(result.tenant, result.branding);
    showForm(form);
    byId('login').focus();
  } catch (failure) {
    showError(errorMessage(failure));
    byId('loading-message').textContent = 'Unable to load terminal setup.';
    byId('retry').hidden = false;
  }
}

byId('retry').addEventListener('click', () => void initializeSetup());
void initializeSetup();
