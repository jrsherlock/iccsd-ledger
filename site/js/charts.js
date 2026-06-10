/* Tiny dependency-free SVG chart helpers for the Ledger */

const tooltip = {
  el: null,
  init() { this.el = document.getElementById("tooltip"); },
  show(html, x, y) {
    this.el.innerHTML = html;
    this.el.classList.add("show");
    const r = this.el.getBoundingClientRect();
    let left = x + 14, top = y - r.height - 10;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top < 8) top = y + 16;
    this.el.style.left = left + "px";
    this.el.style.top = top + "px";
  },
  hide() { this.el.classList.remove("show"); },
};

/**
 * Stacked monthly bar chart.
 * series: [{key, label, color}], data: {month: {key: value}}, months: sorted array
 * onClick(month, key)
 */
function stackedBars(el, months, series, data, onClick) {
  const W = 1080, H = 320, padL = 56, padB = 38, padT = 14, padR = 6;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const totals = months.map(m => series.reduce((s, sr) => s + Math.max(0, (data[m] || {})[sr.key] || 0), 0));
  const maxV = Math.max(...totals, 1);
  const bw = innerW / months.length;

  let g = "";
  // y gridlines at nice intervals
  const step = niceStep(maxV / 4);
  for (let v = step; v <= maxV * 1.02; v += step) {
    const y = padT + innerH - (v / maxV) * innerH;
    g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#d8cdb9" stroke-width="1" stroke-dasharray="1 3"/>`;
    g += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8294a8" font-family="IBM Plex Mono">${moneyShort(v)}</text>`;
  }
  // bars
  months.forEach((m, i) => {
    let y = padT + innerH;
    const x = padL + i * bw + bw * 0.14, w = bw * 0.72;
    series.forEach(sr => {
      const v = Math.max(0, (data[m] || {})[sr.key] || 0);
      if (v <= 0) return;
      const h = (v / maxV) * innerH;
      y -= h;
      g += `<rect class="bar-seg" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" fill="${sr.color}" rx="1"
             data-m="${m}" data-k="${sr.key}" data-v="${v}"/>`;
    });
    // x labels: Jul + Jan markers
    const mm = m.slice(5, 7);
    if (mm === "01" || mm === "07") {
      g += `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10.5" fill="#44556b" font-family="IBM Plex Mono">${fmtMonth(m)}</text>`;
      g += `<line x1="${(padL + i * bw + bw / 2).toFixed(1)}" y1="${padT + innerH}" x2="${(padL + i * bw + bw / 2).toFixed(1)}" y2="${padT + innerH + 5}" stroke="#8294a8"/>`;
    }
    // FY shading boundary
    if (mm === "07") {
      g += `<line x1="${(padL + i * bw).toFixed(1)}" y1="${padT}" x2="${(padL + i * bw).toFixed(1)}" y2="${padT + innerH}" stroke="#b9ab90" stroke-width="1" stroke-dasharray="3 3"/>`;
      g += `<text x="${(padL + i * bw + 5).toFixed(1)}" y="${padT + 11}" font-size="10" fill="#8294a8" font-family="IBM Plex Mono">FY${(+m.slice(2, 4) + 1)}</text>`;
    }
  });
  g += `<line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="#1c2a3a" stroke-width="1.5"/>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  el.querySelectorAll(".bar-seg").forEach(r => {
    r.addEventListener("mousemove", e => {
      const m = r.dataset.m, k = r.dataset.k, v = +r.dataset.v;
      const sr = series.find(s => s.key === k);
      const tot = totals[months.indexOf(m)];
      tooltip.show(
        `<div><strong>${sr.label}</strong> · ${fmtMonth(m)}</div>
         <div class="tt-amt">${fmtUSD.format(v)}</div>
         <div style="opacity:.7">month total ${fmtUSD.format(tot)} — click to view items</div>`,
        e.clientX, e.clientY);
    });
    r.addEventListener("mouseleave", () => tooltip.hide());
    r.addEventListener("click", () => { tooltip.hide(); onClick(r.dataset.m, r.dataset.k); });
  });
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Horizontal bar list rendered as styled divs. items: [{name, sub, value, color, onClick}] */
function barList(el, items, opts = {}) {
  const max = Math.max(...items.map(i => Math.abs(i.value)), 1);
  el.innerHTML = items.map((it, i) => `
    <div class="bl-row" data-i="${i}">
      <div class="bl-name">${esc(it.name)}${it.sub ? ` <span class="bl-sub">${esc(it.sub)}</span>` : ""}</div>
      <div class="bl-amt">${money(it.value)}</div>
      <div class="bl-track"><div class="bl-fill" style="background:${it.color || "var(--navy)"}" data-w="${(Math.abs(it.value) / max * 100).toFixed(1)}"></div></div>
    </div>`).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelectorAll(".bl-fill").forEach(f => f.style.width = f.dataset.w + "%");
  }));
  el.querySelectorAll(".bl-row").forEach(row => {
    row.addEventListener("click", () => items[+row.dataset.i].onClick && items[+row.dataset.i].onClick());
  });
}

/** Squarified treemap. items: [{name, value, color, onClick}] */
function treemap(el, items) {
  const W = el.clientWidth || 1080, H = el.clientHeight || 460;
  const total = items.reduce((s, i) => s + i.value, 0);
  let cells = [];
  squarify(items.map(i => ({ ...i, area: i.value / total * W * H })), { x: 0, y: 0, w: W, h: H }, cells);
  el.innerHTML = cells.map((c, i) => {
    const showText = c.w > 80 && c.h > 34;
    return `<div class="tm-cell" data-i="${i}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;background:${c.color}">
      ${showText ? `<div class="tm-name">${esc(c.name)}</div><div class="tm-amt">${moneyShort(c.value)}</div>` : ""}
    </div>`;
  }).join("");
  el.querySelectorAll(".tm-cell").forEach(d => {
    const c = cells[+d.dataset.i];
    d.addEventListener("mousemove", e => tooltip.show(
      `<div><strong>${esc(c.name)}</strong></div><div class="tt-amt">${fmtUSD.format(c.value)}</div>
       <div style="opacity:.7">${(c.value / total * 100).toFixed(1)}% — click to view items</div>`, e.clientX, e.clientY));
    d.addEventListener("mouseleave", () => tooltip.hide());
    d.addEventListener("click", () => { tooltip.hide(); c.onClick && c.onClick(); });
  });
}

function squarify(items, rect, out) {
  items = items.filter(i => i.area > 0).sort((a, b) => b.area - a.area);
  let row = [], rest = items.slice();
  while (rest.length) {
    const it = rest[0];
    const newRow = row.concat(it);
    if (row.length === 0 || worst(newRow, rect) <= worst(row, rect)) {
      row = newRow; rest = rest.slice(1);
    } else {
      layoutRow(row, rect, out);
      row = [];
    }
  }
  if (row.length) layoutRow(row, rect, out);
}
function worst(row, rect) {
  const s = row.reduce((a, i) => a + i.area, 0);
  const side = Math.min(rect.w, rect.h);
  const thick = s / side;
  let w = 1;
  for (const i of row) {
    const len = i.area / thick;
    w = Math.max(w, thick / len, len / thick);
  }
  return w;
}
function layoutRow(row, rect, out) {
  const s = row.reduce((a, i) => a + i.area, 0);
  const horiz = rect.w >= rect.h;
  const len = horiz ? rect.h : rect.w;
  const thick = s / len;
  let off = 0;
  for (const i of row) {
    const cell = i.area / thick;
    out.push(horiz
      ? { ...i, x: rect.x, y: rect.y + off, w: thick, h: cell }
      : { ...i, x: rect.x + off, y: rect.y, w: cell, h: thick });
    off += cell;
  }
  if (horiz) { rect.x += thick; rect.w -= thick; }
  else { rect.y += thick; rect.h -= thick; }
}

/** Inline sparkline of monthly totals */
function sparkline(months, data, w = 560, h = 64, color = "#234a77") {
  const max = Math.max(...months.map(m => data[m] || 0), 1);
  const bw = w / months.length;
  let bars = "";
  months.forEach((m, i) => {
    const v = data[m] || 0;
    const bh = Math.max((v / max) * (h - 14), v > 0 ? 1.5 : 0);
    bars += `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - 12 - bh).toFixed(1)}" width="${Math.max(bw - 2, 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="1"><title>${fmtMonth(m)}: ${fmtUSD.format(v)}</title></rect>`;
  });
  const labels = months.filter(m => m.slice(5) === "07" || m.slice(5) === "01");
  let lab = "";
  labels.forEach(m => {
    const i = months.indexOf(m);
    lab += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 2}" font-size="9" fill="#8294a8" text-anchor="middle" font-family="IBM Plex Mono">${fmtMonth(m)}</text>`;
  });
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg">${bars}${lab}</svg>`;
}

/** 100%-stacked split bar */
function splitBar(el, parts) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  let cum = 0;
  const segs = parts.map(p => {
    const pct = p.value / total * 100;
    const s = `<div title="${esc(p.label)}: ${fmtUSD.format(p.value)}" style="position:absolute;left:${cum}%;top:0;bottom:0;width:${pct}%;background:${p.color};border-radius:${cum === 0 ? "5px 0 0 5px" : cum + pct > 99.9 ? "0 5px 5px 0" : "0"}"></div>`;
    cum += pct;
    return s;
  }).join("");
  el.innerHTML = `
    <div style="position:relative;height:46px;border-radius:5px;overflow:hidden;margin:6px 0 14px">${segs}</div>
    <div class="legend">${parts.map(p => `
      <div class="legend-item"><div class="legend-swatch" style="background:${p.color}"></div>
      <strong>${esc(p.label)}</strong>&nbsp;·&nbsp;${fmtUSD.format(p.value)} (${(p.value / total * 100).toFixed(1)}%)</div>`).join("")}
    </div>`;
}
