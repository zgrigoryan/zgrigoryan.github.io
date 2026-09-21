(() => {
  const posts = window.SITE_POSTS || [];
  if (!posts.length) return;
  const grid = document.querySelector('.grid');
  grid.replaceChildren();
  document.querySelector('.starter-note').hidden = true;
  for (const post of posts) {
    const article = document.createElement('article');
    article.className = 'entry';
    article.dataset.category = post.category;
    const button = document.createElement('button');
    button.className = 'card-open';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', 'Open ' + post.title);
    const cover = post.blocks.find(block => block.type === 'image' && Posts.mediaSource(block));
    let visual;
    if (cover) {
      visual = document.createElement('img');
      visual.className = 'visual';
      visual.src = cover.src;
      visual.alt = cover.alt || cover.caption || '';
      visual.loading = 'lazy';
    } else {
      visual = document.createElement('span');
      const video = post.blocks.some(block => ['video', 'embed'].includes(block.type));
      visual.className = 'visual post-card-cover' + (video ? ' video-cover' : '');
      visual.textContent = video ? '▷ Video' : post.title;
      visual.setAttribute('aria-hidden', 'true');
    }
    const meta = document.createElement('span');
    meta.className = 'entry-meta';
    meta.textContent = Posts.categories[post.category];
    const title = document.createElement('span');
    title.className = 'post-title';
    title.textContent = post.title;
    const summary = document.createElement('span');
    summary.className = 'post-excerpt';
    summary.textContent = Posts.excerpt(post);
    button.append(visual, meta, title, summary);
    article.append(button);
    grid.append(article);
    button.addEventListener('click', () => {
      const dialog = document.querySelector('#entry-dialog');
      const content = document.querySelector('#dialog-content');
      content.classList.add('published-post');
      document.querySelector('.draft-tag').hidden = true;
      const cleanup = Posts.renderPost(content, post);
      dialog.addEventListener('close', () => { cleanup(); button.focus(); }, { once: true });
      dialog.showModal();
    });
  }
})();
