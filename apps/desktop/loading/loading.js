// Called by the Rust shell when the backend cannot start.
window.pixelsFail = function (message) {
  var error = document.getElementById('error')
  error.style.display = 'grid'
  error.textContent = message + ' Close this window and open pixels again. If it keeps happening, see the README troubleshooting section.'
}
