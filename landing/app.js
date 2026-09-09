const themeKey = 'companion-landing-theme';
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const themeControl = document.querySelector('.theme-control');
const themeButtons = [...themeControl.querySelectorAll('[data-theme-option]')];
const screenshotImages = [...document.querySelectorAll('.screenshot-frame img')];
let themePreference = document.documentElement.dataset.themePreference || 'system';

function syncScreenshotVisibility(image) {
  const source = document.documentElement.dataset.theme === 'dark'
    ? image.closest('picture').querySelector('source').srcset : image.src;
  const expected = new URL(source, document.baseURI).href;
  if (image.currentSrc === expected && image.complete && image.naturalWidth > 0) {
    delete image.dataset.themePending;
  } else {
    image.dataset.themePending = 'true';
  }
}

for (const image of screenshotImages) {
  image.addEventListener('load', () => syncScreenshotVisibility(image));
  image.addEventListener('error', () => { delete image.dataset.themePending; });
}

function applyTheme() {
  const theme = themePreference === 'system'
    ? (systemTheme.matches ? 'dark' : 'light')
    : themePreference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = themePreference;
  for (const button of themeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.themeOption === theme));
  }

  for (const source of document.querySelectorAll('.screenshot-frame source')) {
    source.media = themePreference === 'system'
      ? '(prefers-color-scheme: dark)'
      : theme === 'dark' ? 'all' : 'not all';
  }
  for (const image of screenshotImages) syncScreenshotVisibility(image);
  delete document.documentElement.dataset.themePending;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = theme === 'dark' ? '#141413' : '#fafaf9';
  }
}

for (const button of themeButtons) {
  button.addEventListener('click', () => {
    themePreference = button.dataset.themeOption;
    try { localStorage.setItem(themeKey, themePreference); } catch {}
    applyTheme();
  });
}

systemTheme.addEventListener('change', () => {
  if (themePreference === 'system') applyTheme();
});

window.addEventListener('storage', (event) => {
  if (event.key !== themeKey && event.key !== null) return;
  themePreference = event.newValue === 'light' || event.newValue === 'dark'
    ? event.newValue : 'system';
  applyTheme();
});

applyTheme();
themeControl.hidden = false;

const tablist = document.querySelector('[role="tablist"]');
const tabs = [...tablist.querySelectorAll('[role="tab"]')];

function selectTab(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
}

tablist.addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (tab) selectTab(tab);
});

tablist.addEventListener('keydown', (event) => {
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;

  let next;
  switch (event.key) {
    case 'ArrowRight': next = (index + 1) % tabs.length; break;
    case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
    case 'Home': next = 0; break;
    case 'End': next = tabs.length - 1; break;
    default: return;
  }

  event.preventDefault();
  selectTab(tabs[next]);
  tabs[next].focus();
});
