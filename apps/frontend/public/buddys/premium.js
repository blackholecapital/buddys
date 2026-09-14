// One form and one session across formats: move live nodes, never clone controls.
(() => {
  const workspace = document.getElementById('buddyVideoModal');
  const stage = document.getElementById('premiumStage');
  const dialog = document.getElementById('premiumDialog');
  const tabs = [...document.querySelectorAll('.premium-formats [data-format]')];
  const heading = document.querySelector('#demoForm .card-heading');
  const headingCopy = {
    eyebrow: heading.querySelector('.eyebrow').textContent,
    title: heading.querySelector('h2').textContent,
    body: heading.querySelector('p:last-child').textContent,
  };
  let previousFormat = 'page';
  function setHeading(format) {
    const showroom = format === 'showroom';
    heading.querySelector('.eyebrow').textContent = showroom ? 'SHOP THE COLLECTION WITH BUDDY' : headingCopy.eyebrow;
    heading.querySelector('h2').textContent = showroom ? 'Buddy’s Virtual Showroom' : headingCopy.title;
    heading.querySelector('p:last-child').textContent = showroom
      ? 'Browse, compare, ask Buddy questions, and save your favorites in one premium experience.'
      : headingCopy.body;
  }
  function setFormat(format) {
    if (dialog.open) dialog.close();
    workspace.dataset.format = format;
    setHeading(format);
    tabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === format)));
    if (format === 'popup') {
      dialog.append(workspace);
      dialog.showModal();
    } else {
      previousFormat = format;
      stage.append(workspace);
    }
    window.dispatchEvent(new CustomEvent('buddy:format-requested', {detail:{format}}));
    window.BuddyShowroom?.refresh?.();
  }
  function restore() {
    if (!dialog.contains(workspace)) return;
    workspace.dataset.format = previousFormat;
    stage.append(workspace);
    tabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === previousFormat)));
    tabs.find(button => button.dataset.format === 'popup')?.focus({preventScroll:true});
  }
  tabs.forEach(button => button.addEventListener('click', () => setFormat(button.dataset.format)));

  const icons = {
    message: '<path d="M4 5h16v11H9l-5 4Z"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 9 5-3v12l-5-3Z"/>',
    showroom: '<path d="M5 9h14l1 12H4Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/>',
  };
  document.querySelectorAll('[data-buddy-mode]').forEach(button => {
    const label = button.textContent.trim();
    const key = button.dataset.buddyMode;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]}</svg><span>${label}</span>`;
  });
  document.getElementById('buddyMicButton').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/></svg>';
  document.getElementById('premiumDialogClose').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('buddy:end-requested'));
    dialog.close();
  });
  dialog.addEventListener('cancel', () => window.dispatchEvent(new CustomEvent('buddy:end-requested')));
  dialog.addEventListener('close', restore);
  // BHC compact contact fields, using Buddy's own identity and exact API names.
  document.querySelectorAll('#demoForm .two-column input').forEach(input => {
    const label = input.closest('label');
    const caption = label.textContent.trim();
    input.placeholder = caption;
    input.setAttribute('aria-label', caption);
    label.classList.add('premium-icon-field');
    [...label.childNodes].filter(node => node !== input).forEach(node => node.remove());
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('premium-field-icon'); icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.5');
    icon.innerHTML = input.type === 'email' ? '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 6 9 7 9-7"/>'
      : input.type === 'tel' ? '<path d="m6 3-3 3c0 8 7 15 15 15l3-3-5-4-3 2-5-5 2-3Z"/>'
      : '<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>';
    label.prepend(icon);
  });
  window.BuddyPremium = {
    reveal() {
      workspace.classList.remove('hidden');
      workspace.setAttribute('aria-hidden', 'false');
      if (!dialog.open) workspace.scrollIntoView({behavior:'smooth',block:'start'});
    },
    end() {
      workspace.classList.remove('hidden');
      workspace.setAttribute('aria-hidden', 'false');
    }
  };
})();
