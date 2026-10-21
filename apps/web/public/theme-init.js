// Applies the saved theme before first paint so there is no dark flash for Light Studio users.
// A separate file (not inline) because the Content-Security-Policy forbids inline scripts.
try {
  var saved = JSON.parse(localStorage.getItem('pixels.ui') || '{}')
  var theme = saved && saved.state && saved.state.theme
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch (e) {
  /* storage unavailable: keep the default */
}
