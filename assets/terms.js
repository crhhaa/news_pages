/* 名詞連結與 hover 卡。
 *
 * - 頁面上任何 [data-term="slug"] 都會有 hover 說明。
 * - [data-auto-terms] 內的純文字會自動辨識 terms.json 的中英文名稱、補上連結。
 * - 動態 render 的內容由 MutationObserver 接手，不需要每個 render function 個別呼叫。
 * - slug 不在 terms.json 裡就跳過，不產生死連結。
 */
(function () {
  const base = /\/(lessons|terms|news)\//.test(location.pathname)
    ? '..' : '.';

  fetch(`${base}/assets/terms.json`)
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(setup)
    .catch(() => { /* 還沒 build 出 terms.json，靜靜不做事 */ });

  function setup(TERMS) {
    const card = createCard();
    const bound = new WeakSet();
    const aliases = makeAliases(TERMS);
    let hideTimer;

    function show(el) {
      clearTimeout(hideTimer);
      const t = TERMS[el.dataset.term];
      if (!t) return;
      card.dataset.for = el.dataset.term;
      card.innerHTML =
        `<div style="font-weight:700;color:#0f172a">${esc(t.term)}` +
        `<span style="font-weight:400;color:#94a3b8"> · ${esc(t.zh)}</span></div>` +
        `<div style="margin-top:.3rem">${esc(t.oneline)}</div>` +
        `<div style="margin-top:.45rem;font-size:.7rem;color:#94a3b8">點一下看完整說明 →</div>`;
      card.style.display = 'block';

      const r = el.getBoundingClientRect();
      const w = card.offsetWidth;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2),
                            window.innerWidth - w - 8);
      const above = r.top > card.offsetHeight + 16;
      card.style.left = `${left + window.scrollX}px`;
      card.style.top = `${(above ? r.top - card.offsetHeight - 8 : r.bottom + 8) + window.scrollY}px`;
    }

    const hide = () => {
      hideTimer = setTimeout(() => {
        card.style.display = 'none';
        delete card.dataset.for;
      }, 120);
    };

    function bind(el) {
      if (bound.has(el) || !TERMS[el.dataset.term]) return;
      bound.add(el);

      let a = el;
      if (el.tagName !== 'A') {
        // 向下相容舊的手寫 <span class="term" data-term="...">。
        a = document.createElement('a');
        a.href = `${base}/terms/${el.dataset.term}.html`;
        a.className = el.className;
        a.dataset.term = el.dataset.term;
        a.textContent = el.textContent;
        a.style.cssText = 'cursor:pointer;text-decoration:none;';
        el.replaceWith(a);
        bound.add(a);
      }

      a.setAttribute('aria-describedby', card.id);
      a.addEventListener('mouseenter', () => show(a));
      a.addEventListener('mouseleave', hide);
      a.addEventListener('focus', () => show(a));
      a.addEventListener('blur', hide);
      // 觸控裝置沒有 hover：第一下顯示卡片，第二下才進頁面。
      a.addEventListener('click', e => {
        if (!window.matchMedia('(hover: none)').matches) return;
        if (card.style.display === 'block' && card.dataset.for === a.dataset.term) return;
        e.preventDefault();
        show(a);
      });
    }

    function bindWithin(root) {
      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
      if (root.matches && root.matches('[data-term]')) bind(root);
      root.querySelectorAll('[data-term]').forEach(bind);
    }

    function linkify(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || parent.closest('a,script,style,textarea,code,pre,[data-no-terms]')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => linkifyTextNode(node, aliases));
    }

    bindWithin(document);

    document.querySelectorAll('[data-auto-terms]').forEach(root => {
      linkify(root);
      bindWithin(root);

      let queued = false;
      const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          linkify(root);
          bindWithin(root);
        });
      });
      observer.observe(root, { childList: true, subtree: true });
    });

    document.addEventListener('scroll', () => {
      card.style.display = 'none';
      delete card.dataset.for;
    }, { passive: true });

    function linkifyTextNode(node, aliasList) {
      const text = node.nodeValue;
      const matches = [];

      aliasList.forEach(alias => {
        const re = new RegExp(escapeRegExp(alias.label), 'gi');
        let match;
        while ((match = re.exec(text))) {
          const start = match.index;
          const end = start + match[0].length;
          if (hasValidBoundaries(text, start, end, alias.label)) {
            matches.push({ start, end, text: match[0], slug: alias.slug });
          }
          if (match[0].length === 0) re.lastIndex++;
        }
      });

      if (!matches.length) return;
      matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

      const selected = [];
      let cursor = -1;
      matches.forEach(match => {
        if (match.start >= cursor) {
          selected.push(match);
          cursor = match.end;
        }
      });

      const fragment = document.createDocumentFragment();
      cursor = 0;
      selected.forEach(match => {
        if (match.start > cursor) fragment.append(text.slice(cursor, match.start));
        const a = document.createElement('a');
        a.href = `${base}/terms/${match.slug}.html`;
        a.className = 'term-link';
        a.dataset.term = match.slug;
        a.dataset.autoTerm = '';
        a.textContent = match.text;
        fragment.append(a);
        cursor = match.end;
      });
      if (cursor < text.length) fragment.append(text.slice(cursor));
      node.replaceWith(fragment);
    }
  }

  function makeAliases(TERMS) {
    const seen = new Set();
    const aliases = [];
    Object.entries(TERMS).forEach(([slug, term]) => {
      [term.term, term.zh].forEach(name => {
        String(name || '').split(/\s*[／/]\s*/).forEach(label => {
          label = label.trim();
          const key = label.toLocaleLowerCase();
          if (label.length < 2 || seen.has(key)) return;
          seen.add(key);
          aliases.push({ label, slug });
        });
      });
    });
    return aliases.sort((a, b) => b.label.length - a.label.length);
  }

  function hasValidBoundaries(text, start, end, label) {
    const word = /[A-Za-z0-9_]/;
    if (word.test(label[0]) && start > 0 && word.test(text[start - 1])) return false;
    if (word.test(label[label.length - 1]) && end < text.length && word.test(text[end])) return false;
    return true;
  }

  function createCard() {
    if (!document.getElementById('term-auto-link-style')) {
      const style = document.createElement('style');
      style.id = 'term-auto-link-style';
      style.textContent =
        '.term-link[data-auto-term]{color:inherit;text-decoration-line:underline;' +
        'text-decoration-style:dotted;text-decoration-color:#94a3b8;text-underline-offset:3px}' +
        '.term-link[data-auto-term]:hover{color:#2563eb;text-decoration-color:#2563eb}';
      document.head.appendChild(style);
    }

    const card = document.createElement('div');
    card.id = 'term-hover-card';
    card.className = 'term-card';
    card.setAttribute('role', 'tooltip');
    card.style.cssText = [
      'position:absolute', 'z-index:80', 'display:none', 'max-width:19rem',
      'background:#fff', 'border:1px solid #e2e8f0', 'border-radius:.8rem',
      'padding:.7rem .85rem', 'box-shadow:0 8px 28px rgba(15,23,42,.16)',
      'font-size:.8rem', 'line-height:1.65', 'color:#334155',
      'text-align:left', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(card);
    return card;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
})();
