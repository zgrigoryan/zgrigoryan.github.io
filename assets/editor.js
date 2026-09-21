(() => {
  const $ = selector => document.querySelector(selector);
  const title = $('#post-title');
  const category = $('#post-category');
  const blocksElement = $('#blocks');
  let draft;
  let published = window.SITE_POSTS || [];
  let database;
  let saveTimer;
  let saveQueue = Promise.resolve();
  let dirty = false;
  let busy = false;
  let objectURLs = [];
  const mediaTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'video/mp4', 'video/webm']);
  const newText = () => ({ id: crypto.randomUUID(), type: 'text', html: '' });
  const newDraft = () => ({ id: crypto.randomUUID(), title: '', category: 'art', blocks: [newText()], baseRevision: null, savedAt: null });
  function status(message, error = false) { $('#editor-status').textContent = message; $('#editor-status').dataset.error = String(error); }
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('zara-post-editor', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function dbOperation(mode, callback) {
    return new Promise((resolve, reject) => {
      if (!database) return reject(new Error('Browser storage is unavailable. Drafts cannot be saved here.'));
      const transaction = database.transaction('drafts', mode);
      const request = callback(transaction.objectStore('drafts'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Draft storage was interrupted.'));
    });
  }
  function capture() {
    draft.title = title.value;
    draft.category = category.value;
    blocksElement.querySelectorAll('[data-block-id]').forEach(element => {
      const block = draft.blocks.find(item => item.id === element.dataset.blockId);
      if (block.type === 'text') block.html = Posts.cleanHTML(element.querySelector('.rich-text').innerHTML);
      else {
        block.caption = element.querySelector('[data-field="caption"]').value;
        if (block.type === 'image') block.alt = element.querySelector('[data-field="alt"]').value;
        if (block.type === 'embed') block.url = element.querySelector('[data-field="url"]').value.trim();
      }
    });
    return draft;
  }
  function hasContent(item) { return item.title.trim() || item.blocks.some(block => block.type !== 'text' || block.html.replace(/<[^>]*>/g, '').trim()); }
  async function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!draft) return;
    capture();
    if (!hasContent(draft)) return;
    draft.savedAt = new Date().toISOString();
    const saved = structuredClone(draft);
    $('#save-status').textContent = 'Saving…';
    saveQueue = saveQueue.catch(() => {}).then(() => dbOperation('readwrite', store => store.put(saved)));
    await saveQueue;
    // A later keystroke may already have scheduled another save.
    if (draft.id === saved.id && draft.savedAt === saved.savedAt && !saveTimer) {
      dirty = false;
      $('#save-status').textContent = 'Draft saved on this browser';
    }
    await renderLists();
  }
  function saveError() { $('#save-status').textContent = 'Draft not saved'; status('This browser could not save the draft. Storage may be unavailable or full. Keep this tab open until you have copied your text or published it.', true); }
  function changed() {
    if (busy) return;
    dirty = true;
    $('#save-status').textContent = 'Unsaved changes';
    $('#commit-link').hidden = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveDraft().catch(saveError); }, 800);
  }
  function button(text, label, action) {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = text;
    element.setAttribute('aria-label', label);
    element.addEventListener('click', action);
    return element;
  }
  function addField(container, block, field, label, multiline = false) {
    const id = `${block.id}-${field}`;
    const labelElement = document.createElement('label'); labelElement.htmlFor = id; labelElement.textContent = label;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.id = id; input.dataset.field = field; input.value = block[field] || '';
    if (field === 'url') input.type = 'url';
    container.append(labelElement, input);
    return input;
  }
  function releaseURLs() { objectURLs.forEach(url => URL.revokeObjectURL(url)); objectURLs = []; }
  function renderBlocks() {
    blocksElement.querySelectorAll('video').forEach(video => video.pause());
    releaseURLs();
    blocksElement.replaceChildren();
    draft.blocks.forEach((block, index) => {
      const section = document.createElement('section'); section.className = 'content-block'; section.dataset.blockId = block.id;
      const header = document.createElement('div'); header.className = 'block-header';
      const label = document.createElement('span'); label.textContent = { text: 'Text', image: 'Image', video: 'Video', embed: 'Video link' }[block.type];
      const controls = document.createElement('div'); controls.className = 'block-controls';
      function move(direction) {
        capture(); const target = index + direction;
        [draft.blocks[index], draft.blocks[target]] = [draft.blocks[target], draft.blocks[index]];
        renderBlocks(); changed();
        blocksElement.querySelectorAll('.content-block')[target]?.querySelector('button:not(:disabled)')?.focus();
      }
      const up = button('↑', 'Move block up', () => move(-1)); up.disabled = index === 0;
      const down = button('↓', 'Move block down', () => move(1)); down.disabled = index === draft.blocks.length - 1;
      controls.append(up, down, button('Remove', 'Remove this block', () => {
        capture();
        if ((block.type !== 'text' || block.html) && !window.confirm('Remove this block from the draft?')) return;
        draft.blocks.splice(index, 1); renderBlocks(); changed();
      }));
      header.append(label, controls); section.append(header);
      if (block.type === 'text') {
        const toolbar = document.createElement('div'); toolbar.className = 'toolbar'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Text formatting');
        const editable = document.createElement('div'); editable.className = 'rich-text'; editable.contentEditable = 'true'; editable.dataset.placeholder = 'Write something…'; editable.setAttribute('role', 'textbox'); editable.setAttribute('aria-label', 'Post text'); editable.setAttribute('aria-multiline', 'true'); editable.innerHTML = Posts.cleanHTML(block.html);
        const commands = [['B', 'Bold', 'bold'], ['I', 'Italic', 'italic'], ['H2', 'Heading', 'formatBlock', 'h2'], ['¶', 'Paragraph', 'formatBlock', 'p'], ['• List', 'Bulleted list', 'insertUnorderedList'], ['“', 'Quote', 'formatBlock', 'blockquote']];
        commands.forEach(([text, label, command, value]) => {
          const control = button(text, label, () => { editable.focus(); document.execCommand(command, false, value || null); changed(); });
          control.addEventListener('mousedown', event => event.preventDefault()); toolbar.append(control);
        });
        const link = button('Link', 'Add link to selected text', () => {
          const selection = window.getSelection();
          if (!selection.rangeCount || selection.isCollapsed || !editable.contains(selection.anchorNode) || !editable.contains(selection.focusNode)) { status('Select the words you want to link first.'); return; }
          const range = selection.getRangeAt(0).cloneRange();
          const value = window.prompt('Link address (https://…)');
          if (value === null) return;
          const url = Posts.safeLink(value);
          if (!url) { status('Use a full link beginning with https:// or http://.', true); return; }
          editable.focus(); selection.removeAllRanges(); selection.addRange(range);
          document.execCommand('createLink', false, url); changed();
        });
        link.addEventListener('mousedown', event => event.preventDefault()); toolbar.append(link);
        editable.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); changed(); });
        editable.addEventListener('drop', event => { event.preventDefault(); status('Use “Photo / video” to add files.'); });
        section.append(toolbar, editable);
      } else {
        if (block.type !== 'embed') {
          const preview = document.createElement('div'); preview.className = 'media-preview';
          const media = document.createElement(block.type === 'image' ? 'img' : 'video');
          let src = Posts.mediaSource(block);
          if (src.startsWith('blob:')) objectURLs.push(src);
          // A newly published file may not have reached Pages yet. Editor previews can use the immutable commit URL.
          if (!block.file && src && draft.mediaBase) src = draft.mediaBase + src;
          media.src = src;
          if (block.type === 'image') media.alt = block.alt || block.caption || 'Image preview';
          else { media.controls = true; media.playsInline = true; media.preload = 'metadata'; }
          preview.append(media); section.append(preview);
        }
        const fields = document.createElement('div'); fields.className = 'media-fields';
        if (block.type === 'embed') addField(fields, block, 'url', 'YouTube or Vimeo URL');
        addField(fields, block, 'caption', 'Caption', true);
        if (block.type === 'image') addField(fields, block, 'alt', 'Image description for screen readers');
        section.append(fields);
      }
      blocksElement.append(section);
    });
  }
  function loadDraft(item) {
    clearTimeout(saveTimer); saveTimer = null;
    draft = structuredClone(item);
    draft.blocks.forEach(block => { block.id ||= crypto.randomUUID(); });
    title.value = draft.title; category.value = draft.category;
    dirty = false;
    $('#editing-label').textContent = draft.baseRevision ? 'Edit post' : 'New post';
    $('#save-status').textContent = draft.savedAt ? 'Draft saved on this browser' : 'Not saved yet';
    $('#commit-link').hidden = true;
    status(''); renderBlocks();
  }
  async function switchTo(item) {
    if (busy) return;
    try { await saveDraft(); loadDraft(item); await renderLists(); title.focus(); } catch { saveError(); }
  }
  async function renderLists() {
    const drafts = database ? await dbOperation('readonly', store => store.getAll()) : [];
    const draftList = $('#draft-list'); draftList.replaceChildren();
    for (const item of drafts.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))) {
      const entry = button(item.title || 'Untitled draft', 'Edit draft ' + (item.title || 'Untitled'), () => switchTo(item));
      entry.setAttribute('aria-current', String(item.id === draft?.id)); entry.disabled = busy;
      draftList.append(entry);
    }
    if (!drafts.length) { const empty = document.createElement('p'); empty.textContent = 'No saved drafts.'; draftList.append(empty); }
    const publishedList = $('#published-list'); publishedList.replaceChildren();
    for (const post of published) {
      const entry = button(post.title, 'Edit published post ' + post.title, () => switchTo({ ...post, blocks: post.blocks.map(block => ({ ...block, id: crypto.randomUUID() })), baseRevision: post.revision, savedAt: null, mediaBase: published.mediaBase || '' }));
      entry.disabled = busy;
      publishedList.append(entry);
    }
    if (!published.length) { const empty = document.createElement('p'); empty.textContent = 'No published posts yet.'; publishedList.append(empty); }
  }
  function setBusy(value) {
    busy = value;
    $('#post-fields').disabled = value;
    blocksElement.querySelectorAll('[contenteditable]').forEach(element => { element.contentEditable = String(!value); });
    document.querySelectorAll('#new-post, #save-draft, #preview-post, #publish-post, #connect, #disconnect, .post-list button').forEach(element => { element.disabled = value; });
  }
  async function init() {
    try { database = await openDatabase(); } catch { status('Browser draft storage is unavailable. Use a normal browser window with storage enabled.', true); }
    const drafts = database ? await dbOperation('readonly', store => store.getAll()) : [];
    loadDraft(drafts.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))[0] || newDraft());
    if (!database) saveError();
    await renderLists();
  }
  $('#post-fields').addEventListener('input', changed);
  $('#new-post').addEventListener('click', () => switchTo(newDraft()));
  $('#add-text').addEventListener('click', () => { capture(); draft.blocks.push(newText()); renderBlocks(); changed(); blocksElement.lastElementChild.querySelector('.rich-text').focus(); });
  $('#add-embed').addEventListener('click', () => { capture(); draft.blocks.push({ id: crypto.randomUUID(), type: 'embed', url: '', caption: '' }); renderBlocks(); changed(); blocksElement.lastElementChild.querySelector('input').focus(); });
  $('#add-media').addEventListener('click', () => $('#media-input').click());
  $('#media-input').addEventListener('change', event => {
    const files = [...event.target.files]; event.target.value = '';
    if (files.some(file => !mediaTypes.has(file.type) || file.size > 20 * 1024 * 1024)) { status('Choose a supported image or video, up to 20 MB per file. For longer videos, use a YouTube or Vimeo link.', true); return; }
    const existingSize = draft.blocks.reduce((sum, block) => sum + (block.file?.size || 0), 0);
    if (existingSize + files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) { status('Keep new uploads under 50 MB per post. Use video links for larger videos.', true); return; }
    capture();
    files.forEach(file => draft.blocks.push({ id: crypto.randomUUID(), type: file.type.startsWith('image/') ? 'image' : 'video', file, caption: '', alt: '' }));
    renderBlocks(); changed(); status('');
  });
  $('#save-draft').addEventListener('click', async () => { try { await saveDraft(); if (hasContent(draft)) status('Draft saved on this browser. It is not public.'); else status('Add a title or some content first.'); } catch { saveError(); } });
  $('#preview-post').addEventListener('click', () => {
    capture();
    try { GitHubPublisher.validateDraft(draft); } catch (error) { status(error.message, true); return; }
    const cleanup = Posts.renderPost($('#preview-content'), draft);
    $('#preview-dialog').addEventListener('close', () => { cleanup(); $('#preview-post').focus(); }, { once: true });
    $('#preview-dialog').showModal();
  });
  $('.close-dialog').addEventListener('click', () => $('#preview-dialog').close());
  $('#connect').addEventListener('click', async () => {
    const value = $('#github-token').value;
    $('#github-token').value = '';
    if (!value.trim()) { $('#connection-status').textContent = 'Enter your GitHub access token first.'; return; }
    setBusy(true); $('#connection-status').textContent = 'Connecting…';
    try {
      const current = await GitHubPublisher.connect(value);
      published = current.posts;
      published.mediaBase = `https://raw.githubusercontent.com/zgrigoryan/zgrigoryan.github.io/${current.head}/`;
      $('#connection-status').textContent = 'Connected to zgrigoryan.github.io. Publishing is available.';
      $('#disconnect').hidden = false;
      await renderLists();
    } catch (error) { $('#connection-status').textContent = error.message; $('#disconnect').hidden = true; }
    finally { setBusy(false); }
  });
  $('#disconnect').addEventListener('click', () => { GitHubPublisher.disconnect(); $('#github-token').value = ''; $('#connection-status').textContent = 'Disconnected. Drafts remain on this browser.'; $('#disconnect').hidden = true; });
  $('#publish-post').addEventListener('click', async () => {
    if (busy) return;
    capture();
    try { GitHubPublisher.validateDraft(draft); } catch (error) { status(error.message, true); return; }
    if (!GitHubPublisher.connected()) { $('#connection-panel').open = true; status('Connect GitHub under Publishing access to publish. Your draft will stay on this browser.'); $('#github-token').focus(); return; }
    setBusy(true);
    try {
      await saveDraft();
      const result = await GitHubPublisher.publish(structuredClone(draft), message => status(message));
      published = result.posts;
      const mediaBase = `https://raw.githubusercontent.com/zgrigoryan/zgrigoryan.github.io/${result.url.split('/').pop()}/`;
      published.mediaBase = mediaBase;
      const oldId = draft.id;
      // Keep the draft synchronized if local cleanup fails after a successful publish.
      draft = { ...result.post, baseRevision: result.post.revision, savedAt: null, mediaBase, blocks: result.post.blocks.map(block => ({ ...block, id: crypto.randomUUID() })) };
      let cleanupFailed = false;
      try { await dbOperation('readwrite', store => store.delete(oldId)); } catch { cleanupFailed = true; }
      loadDraft(draft);
      $('#save-status').textContent = 'Saved to GitHub';
      status('Saved to GitHub. Your public site will update after GitHub Pages finishes deploying (usually a few minutes).' + (cleanupFailed ? ' The older local draft could not be removed.' : ''));
      $('#commit-link').href = result.url; $('#commit-link').hidden = false;
      await renderLists();
    } catch (error) { status(error.message, true); }
    finally { setBusy(false); }
  });
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  setBusy(true);
  init().catch(saveError).finally(() => setBusy(false));
})();
