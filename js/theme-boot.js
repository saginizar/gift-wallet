// Sets the color theme before the stylesheet paints, so dark-mode users do not see a
// white flash. Kept outside the module graph because it must run synchronously.
(function () {
  var pref = 'auto';
  try { pref = localStorage.getItem('gw-theme') || 'auto'; } catch (e) { /* storage blocked */ }
  var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
