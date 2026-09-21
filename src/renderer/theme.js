/*
 * Motyw ciemny/jasny. Ladowany synchronicznie w <head> (przed stylami), zeby ustawic
 * data-theme zanim cokolwiek sie narysuje - inaczej przy jasnym motywie bylby widoczny
 * blysk ciemnego tla. Bez zapisanego wyboru podaza za motywem systemu.
 */
(function () {
  const STORAGE_KEY = 'theme';
  const root = document.documentElement;

  function readSaved() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (_error) {
      return null;
    }
  }

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
  }

  apply(readSaved() || systemTheme());

  // Dopoki uzytkownik nie wybral motywu recznie, zmiana motywu systemu przelacza aplike.
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!readSaved()) apply(systemTheme());
  });

  window.themeToggle = {
    current: () => root.getAttribute('data-theme'),
    set(theme) {
      apply(theme);
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (_error) {
        // Brak dostepu do localStorage - motyw dziala do konca sesji.
      }
    },
    toggle() {
      this.set(this.current() === 'light' ? 'dark' : 'light');
    },
  };
})();
