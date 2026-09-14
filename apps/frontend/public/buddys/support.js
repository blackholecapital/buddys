(() => {
  const launcher = document.getElementById('shopperSupportLauncher');
  const panel = document.getElementById('shopperSupportPanel');
  const search = document.getElementById('shopperSupportSearch');
  const articles = [...document.querySelectorAll('#shopperSupportArticles details')];
  const empty = document.getElementById('shopperSupportEmpty');
  if (!launcher || !panel || !search) return;

  const close = () => { panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); };
  const open = () => { panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); requestAnimationFrame(() => search.focus()); };
  launcher.addEventListener('click', () => panel.hidden ? open() : close());
  panel.querySelector('[data-support-close]')?.addEventListener('click', close);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    articles.forEach(article => {
      const matches = !query || `${article.dataset.search || ''} ${article.textContent || ''}`.toLowerCase().includes(query);
      article.hidden = !matches;
      if (matches) shown += 1;
    });
    empty.hidden = shown !== 0;
  });
  panel.querySelectorAll('[data-support-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.supportAction;
    close();
    document.querySelector(`[data-buddy-mode="${action}"]`)?.click();
    document.getElementById('contact-form')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }));
})();
