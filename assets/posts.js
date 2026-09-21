/* Shared post formatting. User text is sanitized before it enters the page. */
(() => {
  const categories = { art: 'Art & sketches', yoga: 'Yoga', photography: 'Photography', books: 'Books', films: 'Films', writing: 'Writing' };
  const allowed = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A', 'DIV']);
  function safeLink(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  }
  function cleanHTML(value) {
    const source = document.createElement('template');
    source.innerHTML = String(value || '');
    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      const fragment = document.createDocumentFragment();
      if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'OBJECT', 'TEMPLATE'].includes(node.tagName)) return fragment;
      const output = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : fragment;
      if (node.tagName === 'A' && safeLink(node.getAttribute('href'))) {
        output.href = safeLink(node.getAttribute('href'));
        output.rel = 'noopener noreferrer';
      }
      for (const child of node.childNodes) output.append(clean(child));
      return output;
    }
    const container = document.createElement('div');
    for (const child of source.content.childNodes) container.append(clean(child));
    return container.innerHTML;
  }
  function videoEmbed(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return '';
      let id;
      if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)\/?$/)?.[1];
      if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
      if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
      if (['vimeo.com', 'www.vimeo.com'].includes(url.hostname)) {
        const match = url.pathname.match(/^\/(\d+)(?:\/([a-zA-Z0-9]+))?\/?$/);
        if (match) return `https://player.vimeo.com/video/${match[1]}${match[2] ? '?h=' + match[2] : ''}`;
      }
    } catch { /* Invalid or unsupported URL. */ }
    return '';
  }
  function mediaSource(block) {
    if (block.file instanceof Blob) return URL.createObjectURL(block.file);
    return /^media\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif|avif|mp4|webm)$/.test(block.src || '') ? block.src : '';
  }
  function excerpt(post) {
    const container = document.createElement('div');
    container.innerHTML = cleanHTML(post.blocks.filter(b => b.type === 'text').map(b => b.html).join(' '));
    return (container.textContent.trim() || post.blocks.find(b => b.caption)?.caption || '').slice(0, 150);
  }
  function renderPost(container, post) {
    const urls = [];
    container.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = post.title;
    heading.id = 'dialog-title';
    container.append(heading);
    const meta = document.createElement('p');
    meta.className = 'post-meta';
    meta.textContent = categories[post.category] || 'Post';
    container.append(meta);
    for (const block of post.blocks) {
      if (block.type === 'text') {
        const section = document.createElement('div');
        section.className = 'post-text';
        section.innerHTML = cleanHTML(block.html);
        container.append(section);
        continue;
      }
      const figure = document.createElement('figure');
      let media;
      if (block.type === 'embed' && videoEmbed(block.url)) {
        media = document.createElement('iframe');
        media.src = videoEmbed(block.url);
        media.title = block.caption || 'Video';
        media.allow = 'fullscreen; picture-in-picture';
        media.allowFullscreen = true;
        media.loading = 'lazy';
        media.referrerPolicy = 'strict-origin-when-cross-origin';
      } else if (['image', 'video'].includes(block.type)) {
        const src = mediaSource(block);
        if (!src) continue;
        if (src.startsWith('blob:')) urls.push(src);
        media = document.createElement(block.type === 'image' ? 'img' : 'video');
        media.src = !block.file && /^https:\/\/raw\.githubusercontent\.com\/zgrigoryan\/zgrigoryan\.github\.io\/[a-f0-9]{40}\/$/.test(post.mediaBase || '') ? post.mediaBase + src : src;
        if (block.type === 'image') { media.alt = block.alt || block.caption || ''; media.loading = 'lazy'; }
        else { media.controls = true; media.playsInline = true; media.preload = 'metadata'; }
      } else continue;
      figure.append(media);
      if (block.caption) {
        const caption = document.createElement('figcaption');
        caption.textContent = block.caption;
        figure.append(caption);
      }
      container.append(figure);
    }
    return () => { container.querySelectorAll('video').forEach(video => video.pause()); urls.forEach(url => URL.revokeObjectURL(url)); container.replaceChildren(); };
  }
  function serialize(posts) {
    return 'window.SITE_POSTS = ' + JSON.stringify(posts, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';\n';
  }
  function parse(source) {
    const match = source.match(/^\s*window\.SITE_POSTS\s*=\s*([\s\S]*);\s*$/);
    if (!match) throw new Error('The saved post file has an unexpected format. It has not been changed.');
    const posts = JSON.parse(match[1]);
    if (!Array.isArray(posts) || posts.some(post => !post || typeof post.id !== 'string' || typeof post.title !== 'string' || !categories[post.category] || !Array.isArray(post.blocks))) throw new Error('The saved posts could not be read. They have not been changed.');
    return posts;
  }
  window.Posts = { categories, safeLink, cleanHTML, videoEmbed, mediaSource, excerpt, renderPost, serialize, parse };
})();
