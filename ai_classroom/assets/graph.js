/* 名詞關聯圖：d3 力導向，可拖曳、可縮放、點節點進說明頁。
 *
 * 資料來自 build_lessons.py 產出的 assets/graph.json。
 * 只在切到「名詞圖」分頁時才跑（classroom.html 呼叫 window.renderGraph）。
 */
(function () {
  let started = false;

  window.renderGraph = function () {
    if (started) return;
    started = true;
    d3.json('assets/graph.json').then(draw).catch(err => {
      document.getElementById('graph').outerHTML =
        '<div class="py-16 text-center text-sm text-gray-400">關聯圖載入失敗，先跑一次 build</div>';
      console.error(err);
    });
  };

  function draw(data) {
    const svg = d3.select('#graph');
    const tip = d3.select('#graphTip');
    const box = svg.node().getBoundingClientRect();
    const W = box.width, H = box.height;

    // 邊要吃節點物件，先各自複製一份，切換顯示時才好重建
    const allNodes = data.nodes.map(d => ({ ...d }));
    const allLinks = data.links.map(d => ({ ...d }));

    svg.append('defs').append('marker')
      .attr('id', 'arrow').attr('viewBox', '0 -5 10 10').attr('refX', 20)
      .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L9,0L0,4').attr('fill', '#cbd5e1');

    const root = svg.append('g');
    const gLink = root.append('g');
    const gNode = root.append('g');

    const zoom = d3.zoom().scaleExtent([0.25, 4])
      .on('zoom', e => root.attr('transform', e.transform));
    svg.call(zoom)
      .on('mousedown.cursor', () => svg.style('cursor', 'grabbing'))
      .on('mouseup.cursor', () => svg.style('cursor', 'grab'));

    const radius = d => d.kind === 'lesson' ? 14 : 8 + Math.min(d.deg, 4) * 1.8;

    const sim = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(l =>
        l.type === 'mentions' ? 170 : l.type === 'confused' ? 90 : 115).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(W / 2, H / 2))
      // 沒有連到主體的小群（例如 benchmark 那條鏈）會被斥力一路推到天邊，
      // 拉回中心的弱力是為了把它們留在畫面裡，不然自動對焦會把整張圖縮成一點。
      .force('x', d3.forceX(W / 2).strength(0.05))
      .force('y', d3.forceY(H / 2).strength(0.07))
      .force('collide', d3.forceCollide().radius(d => radius(d) + 26));

    let link, node, label, neighbours;

    function apply(showLessons) {
      const nodes = allNodes.filter(n => showLessons || n.kind !== 'lesson');
      const keep = new Set(nodes.map(n => n.id));
      const links = allLinks.filter(l => {
        const s = l.source.id || l.source, t = l.target.id || l.target;
        return keep.has(s) && keep.has(t);
      });

      neighbours = new Map(nodes.map(n => [n.id, new Set([n.id])]));
      links.forEach(l => {
        const s = l.source.id || l.source, t = l.target.id || l.target;
        neighbours.get(s).add(t);
        neighbours.get(t).add(s);
      });

      link = gLink.selectAll('line').data(links, l =>
        (l.source.id || l.source) + '>' + (l.target.id || l.target) + l.type)
        .join('line')
        .attr('stroke', l => l.type === 'mentions' ? '#e2e8f0' : '#cbd5e1')
        .attr('stroke-width', l => l.type === 'mentions' ? 2 : 1.4)
        .attr('stroke-dasharray', l => l.type === 'confused' ? '3,3' : null)
        .attr('marker-end', l => l.type === 'succeeds' ? 'url(#arrow)' : null);

      node = gNode.selectAll('circle').data(nodes, d => d.id)
        .join('circle')
        .attr('r', radius)
        // 還沒講過的名詞畫成空心虛線＝待辦。實心＝已經有課程講過。
        .attr('fill', d => d.pending ? '#fff' : d.color)
        .attr('stroke', d => d.pending ? '#cbd5e1' : '#fff')
        .attr('stroke-dasharray', d => d.pending ? '2,2' : null)
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .call(d3.drag()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
        .on('mouseenter', hoverOn)
        .on('mouseleave', hoverOff)
        .on('click', (e, d) => { location.href = d.url; });

      // 英文為主、中文輔助：英文才對得上廠商文件和業界講法
      const clip = s => s.length > 24 ? s.slice(0, 23) + '…' : s;
      label = gNode.selectAll('text').data(nodes, d => d.id)
        .join('text')
        .each(function (d) {
          const t = d3.select(this);
          t.selectAll('tspan').remove();
          if (d.kind === 'lesson') {
            t.append('tspan').attr('x', 0).attr('dy', 0)
              .attr('font-size', 13).attr('font-weight', 700).text(d.label);
            return;
          }
          t.append('tspan').attr('x', 0).attr('dy', 0)
            .attr('font-size', 12).attr('font-weight', 600).text(clip(d.label || d.zh));
          if (d.label && d.zh && d.label !== d.zh) {
            t.append('tspan').attr('x', 0).attr('dy', '1.15em')
              .attr('font-size', 10).attr('font-weight', 400)
              .attr('fill', '#94a3b8').text(clip(d.zh));
          }
        })
        .attr('text-anchor', 'middle')
        .attr('fill', '#475569')
        .style('pointer-events', 'none')
        .style('paint-order', 'stroke')
        .attr('stroke', '#fff').attr('stroke-width', 3);

      sim.nodes(nodes).force('link').links(links);
      // 佈局是隨機起點，不自動對焦的話節點常常一半在畫布外。
      // 只在這次佈局穩定時對焦一次，之後使用者拖曳就不再插手。
      let fitted = false;
      sim.on('end', () => { if (!fitted) { fitted = true; fitView(); } });
      sim.alpha(0.9).restart();
    }

    function fitView() {
      const ns = sim.nodes();
      if (!ns.length) return;
      const pad = 48;
      const [x0, x1] = d3.extent(ns, d => d.x);
      const [y0, y1] = d3.extent(ns, d => d.y);
      const k = Math.min(4, Math.max(0.25,
        Math.min((W - pad * 2) / Math.max(x1 - x0, 1),
                 (H - pad * 2) / Math.max(y1 - y0, 1))));
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity
        .translate(W / 2, H / 2).scale(k)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    }

    function hoverOn(event, d) {
      const near = neighbours.get(d.id);
      node.attr('opacity', n => near.has(n.id) ? 1 : 0.15);
      label.attr('opacity', n => near.has(n.id) ? 1 : 0.12);
      link.attr('opacity', l =>
        (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.08);

      const p = svg.node().getBoundingClientRect();
      tip.classed('hidden', false).html(
        `<div class="font-semibold text-gray-800">${esc(d.label)}` +
        (d.kind === 'term' ? `<span class="text-gray-400 font-normal"> · ${esc(d.zh)}</span>` : '') +
        `</div><div class="text-gray-500 mt-1">${esc(d.oneline)}</div>`)
        .style('left', Math.min(event.clientX - p.left + 14, p.width - 270) + 'px')
        .style('top', (event.clientY - p.top + 14) + 'px');
    }

    function hoverOff() {
      node.attr('opacity', 1);
      label.attr('opacity', 1);
      link.attr('opacity', 1);
      tip.classed('hidden', true);
    }

    sim.on('tick', () => {
      link.attr('x1', l => l.source.x).attr('y1', l => l.source.y)
          .attr('x2', l => l.target.x).attr('y2', l => l.target.y);
      node.attr('cx', d => d.x).attr('cy', d => d.y);
      label.attr('transform', d => `translate(${d.x},${d.y + radius(d) + 12})`);
    });

    // 滑鼠直接滑出整張圖時，殘留的高亮要清掉（只靠節點的 mouseleave 會漏）
    svg.on('mouseleave', hoverOff);

    const toggle = document.getElementById('showLessons');
    toggle.addEventListener('click', () => {
      const on = toggle.dataset.on !== '1';
      toggle.dataset.on = on ? '1' : '0';
      toggle.textContent = on ? '集數節點：顯示中' : '集數節點：已隱藏';
      apply(on);
    });
    document.getElementById('graphReset').addEventListener('click', () => {
      allNodes.forEach(n => { n.fx = null; n.fy = null; });
      sim.alpha(0.9).restart();
    });

    apply(true);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // 直接開 #terms 時，頁面的 inline script 比這支 defer 腳本早跑，
  // 那次 window.renderGraph 還是 undefined，所以這裡自己補一次。
  const view = document.getElementById('view-terms');
  if (view && !view.classList.contains('hidden')) window.renderGraph();
})();
