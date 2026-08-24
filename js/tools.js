/* SwapDraws — tools.js : shape generators, icon library, SVG import, drawing helpers */
(function () {
  const SD = (window.SD = window.SD || {});
  const U = SD.util;
  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ── sample SVG path data into point arrays via geometry API ── */
  function samplePathData(d, step = 2.2) {
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', d);
    let len = 0;
    try { len = path.getTotalLength(); } catch (e) { return []; }
    if (!len || !isFinite(len)) return [];
    const n = Math.max(2, Math.min(600, Math.ceil(len / step)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const pt = path.getPointAtLength((i / n) * len);
      pts.push(pt.x, pt.y);
    }
    return pts;
  }

  /* ═══════════════ SHAPES ═══════════════
     Each gen(w, h, sw) → [{d: pathData}] for the final render AND
     gets sampled into animation strokes. Closed shapes may set fill. */
  function rectD(x, y, w, h, r) { return `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`; }
  function ellipseD(cx, cy, rx, ry) { return `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0 Z`; }
  function polyD(cx, cy, r, n, rot = -Math.PI / 2) { let d = ''; for (let i = 0; i <= n; i++) { const a = rot + (i / n) * Math.PI * 2; d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(2) + ',' + (cy + Math.sin(a) * r).toFixed(2); } return d + 'Z'; }
  function starD(cx, cy, r, n = 5, inner = 0.45) { let d = ''; for (let i = 0; i <= n * 2; i++) { const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2; const rr = i % 2 ? r * inner : r; d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(2) + ',' + (cy + Math.sin(a) * rr).toFixed(2); } return d + 'Z'; }

  const SHAPES = {
    arrowRight: { name: 'Arrow →', gen: (w, h) => [{ d: `M${w * .05},${h / 2} H${w * .82}` }, { d: `M${w * .6},${h * .16} L${w * .95},${h / 2} L${w * .6},${h * .84}` }] },
    arrowLeft: { name: 'Arrow ←', gen: (w, h) => [{ d: `M${w * .95},${h / 2} H${w * .18}` }, { d: `M${w * .4},${h * .16} L${w * .05},${h / 2} L${w * .4},${h * .84}` }] },
    arrowUp: { name: 'Arrow ↑', gen: (w, h) => [{ d: `M${w / 2},${h * .95} V${h * .18}` }, { d: `M${w * .16},${h * .4} L${w / 2},${h * .05} L${w * .84},${h * .4}` }] },
    arrowDown: { name: 'Arrow ↓', gen: (w, h) => [{ d: `M${w / 2},${h * .05} V${h * .82}` }, { d: `M${w * .16},${h * .6} L${w / 2},${h * .95} L${w * .84},${h * .6}` }] },
    arrowBoth: { name: 'Arrow ↔', gen: (w, h) => [{ d: `M${w * .18},${h / 2} H${w * .82}` }, { d: `M${w * .34},${h * .2} L${w * .05},${h / 2} L${w * .34},${h * .8}` }, { d: `M${w * .66},${h * .2} L${w * .95},${h / 2} L${w * .66},${h * .8}` }] },
    curlyArrow: { name: 'Curly arrow', gen: (w, h) => [{ d: `M${w * .08},${h * .25} C${w * .45},${h * -.05} ${w * .8},${h * .1} ${w * .85},${h * .6}` }, { d: `M${w * .65},${h * .55} L${w * .87},${h * .78} L${w * .95},${h * .47}` }] },
    circle: { name: 'Circle', gen: (w, h) => { const r = Math.min(w, h) / 2 - 4; return [{ d: ellipseD(w / 2, h / 2, r, r), fill: true }]; } },
    ellipse: { name: 'Ellipse', gen: (w, h) => [{ d: ellipseD(w / 2, h / 2, w / 2 - 4, h / 2 - 4), fill: true }] },
    rect: { name: 'Rectangle', gen: (w, h) => [{ d: rectD(4, 4, w - 8, h - 8, 1), fill: true }] },
    roundRect: { name: 'Rounded', gen: (w, h) => [{ d: rectD(4, 4, w - 8, h - 8, Math.min(w, h) * 0.14), fill: true }] },
    triangle: { name: 'Triangle', gen: (w, h) => [{ d: `M${w / 2},4 L${w - 4},${h - 4} L4,${h - 4} Z`, fill: true }] },
    pentagon: { name: 'Pentagon', gen: (w, h) => [{ d: polyD(w / 2, h / 2, Math.min(w, h) / 2 - 4, 5), fill: true }] },
    hexagon: { name: 'Hexagon', gen: (w, h) => [{ d: polyD(w / 2, h / 2, Math.min(w, h) / 2 - 4, 6), fill: true }] },
    star: { name: 'Star', gen: (w, h) => [{ d: starD(w / 2, h / 2, Math.min(w, h) / 2 - 4), fill: true }] },
    heart: { name: 'Heart', gen: (w, h) => [{ d: `M${w / 2},${h * .9} C${w * .05},${h * .55} ${w * .02},${h * .12} ${w * .26},${h * .1} C${w * .4},${h * .1} ${w / 2},${h * .22} ${w / 2},${h * .3} C${w / 2},${h * .22} ${w * .6},${h * .1} ${w * .74},${h * .1} C${w * .98},${h * .12} ${w * .95},${h * .55} ${w / 2},${h * .9} Z`, fill: true }] },
    speechOval: { name: 'Speech oval', gen: (w, h) => [{ d: ellipseD(w / 2, h * .42, w / 2 - 5, h * .4), fill: true }, { d: `M${w * .3},${h * .78} L${w * .18},${h * .99} L${w * .42},${h * .82}` }] },
    speechRect: { name: 'Speech box', gen: (w, h) => [{ d: rectD(4, 4, w - 8, h * .72, 10), fill: true }, { d: `M${w * .28},${h * .74} L${w * .2},${h * .98} L${w * .44},${h * .75}` }] },
    thought: { name: 'Thought', gen: (w, h) => [{ d: ellipseD(w / 2, h * .35, w * .42, h * .3), fill: true }, { d: ellipseD(w * .25, h * .75, w * .07, w * .07) }, { d: ellipseD(w * .13, h * .92, w * .04, w * .04) }] },
    braceRight: { name: 'Brace }', gen: (w, h) => [{ d: `M${w * .3},2 Q${w * .7},2 ${w * .7},${h * .2} V${h * .35} Q${w * .7},${h * .5} ${w * .95},${h * .5} Q${w * .7},${h * .5} ${w * .7},${h * .65} V${h * .8} Q${w * .7},${h - 2} ${w * .3},${h - 2}` }] },
    underline: { name: 'Underline', gen: (w, h) => [{ d: `M4,${h / 2} H${w - 4}` }] },
    squiggle: { name: 'Squiggle', gen: (w, h) => { let d = `M4,${h / 2}`; const amp = h * .3, wl = w / 9; for (let x = 4; x <= w - 4; x += 4) d += ` L${x},${h / 2 + Math.sin(x / wl * Math.PI * 2) * amp}`; return [{ d }]; } },
    check: { name: 'Check ✓', gen: (w, h) => [{ d: `M${w * .1},${h * .55} L${w * .4},${h * .85} L${w * .92},${h * .12}` }] },
    cross: { name: 'Cross ✗', gen: (w, h) => [{ d: `M${w * .15},${h * .15} L${w * .85},${h * .85}` }, { d: `M${w * .85},${h * .15} L${w * .15},${h * .85}` }] },
    highlight: { name: 'Highlight', gen: (w, h) => [{ d: `M4,${h / 2} H${w - 4}`, wide: true }] },
    lightning: { name: 'Lightning', gen: (w, h) => [{ d: `M${w * .58},4 L${w * .18},${h * .58} L${w * .46},${h * .58} L${w * .4},${h - 4} L${w * .82},${h * .4} L${w * .54},${h * .4} Z`, fill: true }] },
    spiral: { name: 'Spiral', gen: (w, h) => { const cx = w / 2, cy = h / 2, maxR = Math.min(w, h) / 2 - 5; let d = ''; const turns = 3.2, nPts = 160; for (let i = 0; i <= nPts; i++) { const t = i / nPts, a = t * turns * Math.PI * 2, r = 3 + t * maxR; d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(1) + ',' + (cy + Math.sin(a) * r).toFixed(1); } return [{ d }]; } },
    flowBox: { name: 'Flow box', gen: (w, h) => [{ d: rectD(4, 4, w - 8, h - 8, Math.min(w, h) * .08), fill: true }] },
    flowDiamond: { name: 'Diamond', gen: (w, h) => [{ d: `M${w / 2},4 L${w - 4},${h / 2} L${w / 2},${h - 4} L4,${h / 2} Z`, fill: true }] },
    sticky: { name: 'Sticky note', gen: (w, h) => [{ d: `M4,4 H${w - 4} V${h * .72} L${w * .72},${h - 4} H4 Z`, fill: true }, { d: `M${w * .72},${h - 4} V${h * .72} H${w - 4}` }] },
    lineV: { name: 'Divider ┃', gen: (w, h) => [{ d: `M${w / 2},4 V${h - 4}` }] },
  };

  /* ═══════════════ ICONS (24×24 stroke icons, hand-friendly) ═══════════════ */
  const ICONS = {
    home: { tags: 'house building', d: ['M3 11 L12 4 L21 11', 'M5.5 9.8 V20 H18.5 V9.8'] },
    user: { tags: 'person profile', d: ['M12 11.5 a4 4 0 1 0 0.01 0 Z', 'M4.5 20 C4.5 15.5 8 13.5 12 13.5 C16 13.5 19.5 15.5 19.5 20'] },
    users: { tags: 'team people group', d: ['M9 11 a3.5 3.5 0 1 0 0.01 0 Z', 'M2.8 19 C3 15.2 5.6 13.5 9 13.5 C12.4 13.5 15 15.2 15.2 19', 'M15.5 8 a3 3 0 1 1 3 4.5', 'M17 13.8 C19.8 14.4 21.5 16.2 21.7 19'] },
    search: { tags: 'find magnifier zoom', d: ['M10.5 17.5 a7 7 0 1 0 0.01 0 Z', 'M15.8 15.8 L21 21'] },
    heart: { tags: 'love like', d: ['M12 20.5 C5.5 15.5 3 11.5 3 8.5 C3 5.8 5.2 4 7.5 4 C9.3 4 11 5.2 12 6.8 C13 5.2 14.7 4 16.5 4 C18.8 4 21 5.8 21 8.5 C21 11.5 18.5 15.5 12 20.5 Z'] },
    star: { tags: 'favorite rating', d: ['M12 3.5 L14.7 9 L20.5 9.8 L16.2 13.8 L17.5 19.8 L12 16.6 L6.5 19.8 L7.8 13.8 L3.5 9.8 L9.3 9 Z'] },
    check: { tags: 'ok done tick yes', d: ['M4 12.5 L9.5 18 L20 6.5'] },
    cross: { tags: 'no x wrong delete', d: ['M6 6 L18 18', 'M18 6 L6 18'] },
    plus: { tags: 'add new', d: ['M12 5 V19', 'M5 12 H19'] },
    arrowRight: { tags: 'next forward direction', d: ['M4 12 H19', 'M13 6 L19 12 L13 18'] },
    arrowUp: { tags: 'upload direction', d: ['M12 20 V5', 'M6 11 L12 5 L18 11'] },
    arrowDown: { tags: 'download direction', d: ['M12 4 V19', 'M6 13 L12 19 L18 13'] },
    bulb: { tags: 'idea light insight', d: ['M9.5 18 H14.5', 'M10.5 21 H13.5', 'M12 3.5 a6 6 0 0 1 3.6 10.8 C14.8 15.2 14.5 15.8 14.5 16.5 H9.5 C9.5 15.8 9.2 15.2 8.4 14.3 A6 6 0 0 1 12 3.5 Z'] },
    gear: { tags: 'settings config cog', d: ['M12 15.5 a3.5 3.5 0 1 0 0.01 0 Z', 'M12 2.8 V5 M12 19 V21.2 M2.8 12 H5 M19 12 H21.2 M5.5 5.5 L7.2 7.2 M16.8 16.8 L18.5 18.5 M18.5 5.5 L16.8 7.2 M7.2 16.8 L5.5 18.5'] },
    chartBar: { tags: 'graph data statistics', d: ['M3.5 3.5 V20.5 H21', 'M7.5 16 V10', 'M12 16 V6.5', 'M16.5 16 V12.5'] },
    chartLine: { tags: 'graph growth trend', d: ['M3.5 3.5 V20.5 H21', 'M6 15.5 L10.5 10 L14 13 L19.5 6.5', 'M15.5 6.5 H19.5 V10.5'] },
    pie: { tags: 'chart data share', d: ['M12 3 a9 9 0 1 0 9 9 H12 Z', 'M15 3.5 a7.5 7.5 0 0 1 5.5 5.5 H15 Z'] },
    rocket: { tags: 'launch startup fast', d: ['M12 15.5 C9 15.5 7 13 7.6 9.8 C8.4 5.8 11 3.3 15 2.5 C16.5 2.2 18.5 2 19.5 2 C19.5 7 18 10.5 14.8 13.2 C14 14 13 15.5 12 15.5 Z', 'M7.5 13.5 C5.5 13.8 4 16 3.5 20.5 C7.5 20 9.5 18.5 10 16.5', 'M14.5 8 a1.8 1.8 0 1 0 0.01 0 Z', 'M5 14 L9.5 18.5'] },
    phone: { tags: 'call contact', d: ['M6.8 3.5 C7.5 3.5 9.5 6.5 9.2 7.4 C9 7.9 7.7 8.8 7.4 9.3 C8.9 12.3 11.7 15.1 14.7 16.6 C15.2 16.3 16.1 15 16.6 14.8 C17.5 14.5 20.5 16.5 20.5 17.2 C20.5 19.5 18.6 20.6 16.8 20.3 C11 19.3 4.7 13 3.7 7.2 C3.4 5.4 4.5 3.5 6.8 3.5 Z'] },
    mail: { tags: 'email message letter', d: ['M3.5 5.5 H20.5 V18.5 H3.5 Z', 'M4 6.5 L12 13 L20 6.5'] },
    calendar: { tags: 'date schedule event', d: ['M4 5.5 H20 V20.5 H4 Z', 'M4 9.5 H20', 'M8 3 V7 M16 3 V7'] },
    clock: { tags: 'time watch hour', d: ['M12 21 a9 9 0 1 0 0.01 0 Z', 'M12 6.5 V12 L15.5 14'] },
    cloud: { tags: 'weather storage sky', d: ['M6.5 18.5 a4.5 4.5 0 0 1 -0.4 -9 A6 6 0 0 1 17.8 8 a4.8 4.8 0 0 1 0.4 9.6 H7 Z'] },
    lock: { tags: 'secure private password', d: ['M5.5 10.5 H18.5 V20.5 H5.5 Z', 'M8 10.5 V7.5 a4 4 0 0 1 8 0 V10.5', 'M12 14.5 V17'] },
    globe: { tags: 'world internet earth', d: ['M12 21 a9 9 0 1 0 0.01 0 Z', 'M3 12 H21', 'M12 3 C15 5.5 16.5 8.5 16.5 12 C16.5 15.5 15 18.5 12 21 C9 18.5 7.5 15.5 7.5 12 C7.5 8.5 9 5.5 12 3 Z'] },
    camera: { tags: 'photo picture', d: ['M4 7.5 H8 L9.8 5 H14.2 L16 7.5 H20 V19 H4 Z', 'M12 16 a3.5 3.5 0 1 0 0.01 0 Z'] },
    image: { tags: 'picture photo landscape', d: ['M4 5 H20 V19 H4 Z', 'M4 15.5 L9.5 10 L14 14.5 L17 11.5 L20 14.5', 'M8.5 9.5 a1.3 1.3 0 1 0 0.01 0 Z'] },
    play: { tags: 'video start media', d: ['M12 21 a9 9 0 1 0 0.01 0 Z', 'M10 8.5 L16 12 L10 15.5 Z'] },
    music: { tags: 'note song audio', d: ['M9 18.5 a2.5 2.5 0 1 0 0.01 0 Z', 'M16.5 16.5 a2.5 2.5 0 1 0 0.01 0 Z', 'M11.5 18.5 V6 L19 4 V16.5', 'M11.5 9.5 L19 7.5'] },
    mic: { tags: 'record voice audio', d: ['M12 14.5 a3 3 0 0 0 3 -3 V6 a3 3 0 0 0 -6 0 V11.5 a3 3 0 0 0 3 3 Z', 'M6 11.5 a6 6 0 0 0 12 0', 'M12 17.5 V21', 'M8.5 21 H15.5'] },
    file: { tags: 'document page report', d: ['M6 3.5 H14 L18.5 8 V20.5 H6 Z', 'M13.5 3.5 V8.5 H18.5'] },
    folder: { tags: 'files directory', d: ['M3.5 6.5 a1.5 1.5 0 0 1 1.5 -1.5 H9.5 L12 8 H19 a1.5 1.5 0 0 1 1.5 1.5 V18 a1.5 1.5 0 0 1 -1.5 1.5 H5 A1.5 1.5 0 0 1 3.5 18 Z'] },
    link: { tags: 'url chain connect', d: ['M9.5 14.5 L14.5 9.5', 'M11 6.5 L13 4.5 a4 4 0 0 1 6 6 L17 12.5', 'M13 17.5 L11 19.5 a4 4 0 0 1 -6 -6 L7 11.5'] },
    trash: { tags: 'delete bin remove', d: ['M4.5 6.5 H19.5', 'M9 6 V4 H15 V6', 'M6.5 6.5 L7.5 20.5 H16.5 L17.5 6.5', 'M10 10.5 V16.5 M14 10.5 V16.5'] },
    pencil: { tags: 'edit write draw', d: ['M4 20 L5 15.5 L15.8 4.7 a1.9 1.9 0 0 1 2.7 2.7 L7.8 18.2 Z', 'M13.5 7 L16.5 10'] },
    download: { tags: 'save arrow get', d: ['M12 4 V15', 'M6.5 10.5 L12 16 L17.5 10.5', 'M4.5 20 H19.5'] },
    upload: { tags: 'send arrow share', d: ['M12 15 V4', 'M6.5 9.5 L12 4 L17.5 9.5', 'M4.5 20 H19.5'] },
    flag: { tags: 'goal milestone country', d: ['M5.5 21.5 V3.5', 'M5.5 4.5 C9 2.8 12.5 6.2 18.5 4.5 V13 C12.5 14.7 9 11.3 5.5 13'] },
    tag: { tags: 'price label sale', d: ['M11 3.5 H20.5 V13 L12.5 21 a1.4 1.4 0 0 1 -2 0 L3 13.5 a1.4 1.4 0 0 1 0 -2 Z', 'M15.5 8.5 a1.5 1.5 0 1 0 0.01 0 Z'] },
    cart: { tags: 'shop buy ecommerce', d: ['M3 4 H5.5 L8 15.5 H19.5 L21.5 7 H7', 'M9 20 a1.3 1.3 0 1 0 0.01 0 Z', 'M17.5 20 a1.3 1.3 0 1 0 0.01 0 Z'] },
    gift: { tags: 'present surprise', d: ['M4.5 8.5 H19.5 V13 H4.5 Z', 'M5.5 13 H18.5 V21 H5.5 Z', 'M12 8.5 V21', 'M12 8.5 C10 8.5 7.5 7.8 7.5 5.8 C7.5 3.3 11 3.8 12 8.5 C13 3.8 16.5 3.3 16.5 5.8 C16.5 7.8 14 8.5 12 8.5 Z'] },
    mapPin: { tags: 'location place marker', d: ['M12 21.5 C7 15 5 11.8 5 9 a7 7 0 0 1 14 0 C19 11.8 17 15 12 21.5 Z', 'M12 11.5 a2.5 2.5 0 1 0 0.01 0 Z'] },
    bell: { tags: 'notification alert ring', d: ['M18 16.5 H6 C7.5 14.8 8 13.2 8 10.5 a4 4 0 0 1 8 0 C16 13.2 16.5 14.8 18 16.5 Z', 'M10.3 19.5 a2 2 0 0 0 3.4 0'] },
    message: { tags: 'chat talk comment', d: ['M4 5.5 H20 V16 H12 L7 20 V16 H4 Z', 'M8 9 H16 M8 12 H13'] },
    thumbsUp: { tags: 'like agree good', d: ['M7 11 H4 V20 H7', 'M7 20 H16.5 a2 2 0 0 0 2 -1.6 L20 11.6 A2 2 0 0 0 18 9.5 H14 L14.8 5.2 A2.2 2.2 0 0 0 10.6 4 L7 10.5 V20'] },
    wifi: { tags: 'internet signal wireless', d: ['M2.5 9.5 a15 15 0 0 1 19 0', 'M5.8 13 a10 10 0 0 1 12.4 0', 'M9.2 16.5 a5 5 0 0 1 5.6 0', 'M12 20 h.01'] },
    sun: { tags: 'day weather bright', d: ['M12 16.5 a4.5 4.5 0 1 0 0.01 0 Z', 'M12 2.5 V4.5 M12 19.5 V21.5 M2.5 12 H4.5 M19.5 12 H21.5 M5 5 L6.5 6.5 M17.5 17.5 L19 19 M19 5 L17.5 6.5 M6.5 17.5 L5 19'] },
    moon: { tags: 'night sleep dark', d: ['M20.5 14.5 A8.5 8.5 0 1 1 9.5 3.5 a7 7 0 0 0 11 11 Z'] },
    coffee: { tags: 'cup drink break', d: ['M4.5 9.5 H17.5 V15 a5 5 0 0 1 -5 5 H9.5 a5 5 0 0 1 -5 -5 Z', 'M17.5 10.5 a2.5 2.5 0 0 1 0 5', 'M7.5 3.5 C7.5 5 8.5 5 8.5 6.5 M11.5 3.5 C11.5 5 12.5 5 12.5 6.5'] },
    key: { tags: 'password access unlock', d: ['M8 15 a4.5 4.5 0 1 0 -1 -2.8 L3 16.2 V19.5 H6.5 L7.5 18.5 V16.5 H9.5 Z', 'M14.5 9.5 L11.5 12.5'] },
    eye: { tags: 'view look see watch', d: ['M2.5 12 C5.5 6.5 8.8 4.5 12 4.5 C15.2 4.5 18.5 6.5 21.5 12 C18.5 17.5 15.2 19.5 12 19.5 C8.8 19.5 5.5 17.5 2.5 12 Z', 'M12 15 a3 3 0 1 0 0.01 0 Z'] },
    target: { tags: 'goal aim focus', d: ['M12 21 a9 9 0 1 0 0.01 0 Z', 'M12 17 a5 5 0 1 0 0.01 0 Z', 'M12 13 a1 1 0 1 0 0.01 0 Z'] },
    trophy: { tags: 'win award champion', d: ['M7 4 H17 V11 a5 5 0 0 1 -10 0 Z', 'M7 5.5 H4 a3 3 0 0 0 3.2 5', 'M17 5.5 H20 a3 3 0 0 1 -3.2 5', 'M12 16 V19', 'M8.5 20.5 H15.5'] },
    zap: { tags: 'energy fast power flash', d: ['M13 2.5 L5 13.5 H11 L10 21.5 L19 10 H13 Z'] },
    award: { tags: 'medal ribbon winner', d: ['M12 14 a5.5 5.5 0 1 0 0.01 0 Z', 'M9 12.8 L7.5 21 L12 18.7 L16.5 21 L15 12.8'] },
    compass: { tags: 'navigate direction explore', d: ['M12 21 a9 9 0 1 0 0.01 0 Z', 'M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z'] },
    smile: { tags: 'happy face emoji', d: ['M12 21 a9 9 0 1 0 0.01 0 Z', 'M8 14.5 C9.5 16.2 14.5 16.2 16 14.5', 'M9 9.5 h.01 M15 9.5 h.01'] },
    megaphone: { tags: 'announce shout marketing', d: ['M4 10.5 V14.5 H7 L8 18 H10.5 V15 L18 20 V5 L7 10.5 Z', 'M20.5 9 a4.5 4.5 0 0 1 0 7'] },
    book: { tags: 'read learn study', d: ['M4.5 5 C7.5 3.8 10 4.2 12 6 C14 4.2 16.5 3.8 19.5 5 V18.5 C16.5 17.3 14 17.7 12 19.5 C10 17.7 7.5 17.3 4.5 18.5 Z', 'M12 6 V19.5'] },
    lightbulb2: { tags: 'tip hint', d: ['M12 3 a6 6 0 0 1 3.5 10.9 C14.8 14.9 14.5 15.5 14.5 16 H9.5 C9.5 15.5 9.2 14.9 8.5 13.9 A6 6 0 0 1 12 3 Z', 'M9.8 18.5 H14.2', 'M10.8 20.8 H13.2'] },
  };

  /* ═══════════════ facades used by the engine ═══════════════ */
  function renderShape(ctx, layer) {
    const sh = layer.shape;
    const def = SHAPES[sh.shapeId];
    if (!def) return;
    const parts = def.gen(layer.w, layer.h, sh.sw);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const part of parts) {
      const p2d = new Path2D(part.d);
      if (part.fill && sh.fill && sh.fill !== 'none') { ctx.fillStyle = sh.fill; ctx.fill(p2d); }
      ctx.strokeStyle = sh.stroke;
      ctx.lineWidth = sh.sw;
      ctx.stroke(p2d);
    }
  }
  function shapeStrokes(layer) {
    const sh = layer.shape;
    const def = SHAPES[sh.shapeId];
    if (!def) return [];
    const out = [];
    for (const part of def.gen(layer.w, layer.h, sh.sw)) {
      const pts = samplePathData(part.d, 2.5);
      if (pts.length >= 4) out.push({ pts, color: sh.stroke, width: sh.sw });
    }
    return out;
  }

  function iconScale(layer) { return Math.min(layer.w, layer.h) / 24; }
  function renderIcon(ctx, layer) {
    const ic = layer.icon;
    const def = ICONS[ic.iconId];
    if (!def) return;
    ctx.save();
    ctx.translate((layer.w - Math.min(layer.w, layer.h)) / 2, (layer.h - Math.min(layer.w, layer.h)) / 2);
    ctx.scale(iconScale(layer), iconScale(layer));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = ic.color;
    ctx.lineWidth = (ic.sw || 2);
    for (const d of def.d) ctx.stroke(new Path2D(d));
    ctx.restore();
  }
  function iconStrokes(layer) {
    const ic = layer.icon;
    const def = ICONS[ic.iconId];
    if (!def) return [];
    const s = iconScale(layer);
    const ox = (layer.w - Math.min(layer.w, layer.h)) / 2, oy = (layer.h - Math.min(layer.w, layer.h)) / 2;
    const out = [];
    for (const d of def.d) {
      const pts = samplePathData(d, 1.6);
      if (pts.length >= 4) {
        for (let i = 0; i < pts.length; i += 2) { pts[i] = ox + pts[i] * s; pts[i + 1] = oy + pts[i + 1] * s; }
        out.push({ pts, color: ic.color, width: (ic.sw || 2) * s });
      }
    }
    return out;
  }

  /* ═══════════════ SVG import ═══════════════ */
  async function importSVG(file) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg || doc.querySelector('parsererror')) throw new Error('Invalid SVG');
    // viewBox
    let vb = svg.getAttribute('viewBox');
    let vbX = 0, vbY = 0, vbW = parseFloat(svg.getAttribute('width')) || 300, vbH = parseFloat(svg.getAttribute('height')) || 150;
    if (vb) { const p = vb.trim().split(/[\s,]+/).map(Number); if (p.length === 4) { vbX = p[0]; vbY = p[1]; vbW = p[2]; vbH = p[3]; } }
    // normalize: inject viewBox + explicit size so it rasterizes correctly
    svg.setAttribute('width', String(vbW));
    svg.setAttribute('height', String(vbH));
    const normText = new XMLSerializer().serializeToString(svg);
    const contentURL = URL.createObjectURL(new Blob([normText], { type: 'image/svg+xml' }));
    // sample every path-like element in document order
    const strokes = [];
    const els = doc.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon');
    let idx = 0;
    for (const el of els) {
      let d = null;
      const tag = el.tagName.toLowerCase();
      if (tag === 'path') d = el.getAttribute('d');
      else if (tag === 'rect') {
        const x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0, w = +el.getAttribute('width') || 0, h = +el.getAttribute('height') || 0;
        const r = Math.min(+el.getAttribute('rx') || 0, w / 2);
        d = rectD(x, y, w, h, r);
      } else if (tag === 'circle') d = ellipseD(+el.getAttribute('cx') || 0, +el.getAttribute('cy') || 0, +el.getAttribute('r') || 0, +el.getAttribute('r') || 0);
      else if (tag === 'ellipse') d = ellipseD(+el.getAttribute('cx') || 0, +el.getAttribute('cy') || 0, +el.getAttribute('rx') || 0, +el.getAttribute('ry') || 0);
      else if (tag === 'line') d = `M${+el.getAttribute('x1') || 0},${+el.getAttribute('y1') || 0} L${+el.getAttribute('x2') || 0},${+el.getAttribute('y2') || 0}`;
      else { const p = (el.getAttribute('points') || '').trim(); if (p) d = 'M' + p.replace(/[\s,]+/g, ' ').replace(/ /g, ' L') + (tag === 'polygon' ? 'Z' : ''); }
      if (!d) continue;
      const style = (el.getAttribute('style') || '');
      let color = el.getAttribute('stroke') || /stroke:\s*([^;]+)/.exec(style)?.[1] || null;
      if (color === 'none') color = null;
      const fill = el.getAttribute('fill') || /fill:\s*([^;]+)/.exec(style)?.[1] || null;
      let width = parseFloat(el.getAttribute('stroke-width') || /stroke-width:\s*([\d.]+)/.exec(style)?.[1] || '2') || 2;
      if (color && /url\(/.test(color)) color = null;
      const pts = samplePathData(d, Math.max(vbW, vbH) / 320);
      if (pts.length >= 4) strokes.push({ pts: pts.map((v, i) => i % 2 ? v - vbY : v - vbX), color: color || (fill && fill !== 'none' ? fill : '#222831'), width, _i: idx++ });
    }
    strokes.sort((a, b) => a._i - b._i);
    for (const s of strokes) delete s._i;
    return { strokes, contentURL, vbW, vbH, hasFills: !!doc.querySelector('[fill]:not([fill="none"])') };
  }

  /* ═══════════════ drawing helpers ═══════════════ */
  function appendPoint(pts, x, y, minDist = 2) {
    const n = pts.length;
    if (n >= 2) {
      const dx = x - pts[n - 2], dy = y - pts[n - 1];
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    pts.push(x, y);
    return true;
  }
  /* light Ramer–Douglas–Peucker */
  function simplifyStroke(pts, eps = 1.2) {
    if (pts.length <= 6) return pts;
    const keep = new Uint8Array(pts.length / 2);
    keep[0] = keep[pts.length / 2 - 1] = 1;
    const stack = [[0, pts.length / 2 - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1e-6;
      let maxD = 0, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const dx = (by - ay) * pts[i * 2] - (bx - ax) * pts[i * 2 + 1] + bx * ay - by * ax;
        const d = Math.abs(dx) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    const out = [];
    for (let i = 0; i < keep.length; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
    return out;
  }

  SD.tools = { SHAPES, ICONS, samplePathData, renderShape, shapeStrokes, renderIcon, iconStrokes, importSVG, appendPoint, simplifyStroke, rectD, ellipseD };
})();
