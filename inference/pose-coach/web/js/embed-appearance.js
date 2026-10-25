/** Appearance only: called after the exact parent-origin connection has been established. */
export const themeOf = value => value === 'light' || value === 'dark' ? value : null;

export function connectAppearance(win, link) {
  const root = win.document.documentElement;
  const system = win.matchMedia('(prefers-color-scheme: dark)');
  let hostTheme = themeOf(new URLSearchParams(win.location.search).get('theme'));
  const apply = () => { root.dataset.theme = hostTheme || (system.matches ? 'dark' : 'light'); };
  apply();
  system.addEventListener('change', apply);
  link.on('theme', message => {
    const next = themeOf(message.theme);
    if (!next) return;
    hostTheme = next;
    apply();
  });
  // The website owns scrolling. Report content height, not the iframe's viewport height, to avoid resize feedback.
  let lastHeight = 0;
  const resize = () => {
    const height = Math.ceil(win.document.body.getBoundingClientRect().height);
    if (height > 0 && height !== lastHeight) { lastHeight = height; link.send('resize', { height }); }
  };
  const observer = new win.ResizeObserver(resize);
  observer.observe(win.document.body);
  resize();
  win.addEventListener('pagehide', () => { observer.disconnect(); system.removeEventListener('change', apply); }, { once: true });
}
