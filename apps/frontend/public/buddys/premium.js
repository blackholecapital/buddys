// One form and one session across formats: move live nodes, never clone controls.
(() => {
  const workspace = document.getElementById('buddyVideoModal');
  const stage = document.getElementById('premiumStage');
  const dialog = document.getElementById('premiumDialog');
  const tabs = [...document.querySelectorAll('.premium-formats [data-format]')];
  let previousFormat = 'page';
  function setFormat(format) {
    if (dialog.open) dialog.close();
    workspace.dataset.format = format;
    tabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === format)));
    if (format === 'popup') {
      dialog.append(workspace);
      dialog.showModal();
    } else {
      previousFormat = format;
      stage.append(workspace);
    }
  }
  function restore() {
    if (!dialog.contains(workspace)) return;
    workspace.dataset.format = previousFormat;
    stage.append(workspace);
    tabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.format === previousFormat)));
    tabs.find(button => button.dataset.format === 'popup')?.focus({preventScroll:true});
  }
  tabs.forEach(button => button.addEventListener('click', () => setFormat(button.dataset.format)));
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
