// MemManBook visualizer: replays the JSON trace written by `MemManBook --trace web/trace.js`.
// Every frame is rebuilt from the real event list; nothing here invents allocator state.
(function () {
  "use strict";

  const TRACE = window.MEMMAN_TRACE;
  if (!TRACE) {
    document.getElementById("captionText").textContent =
      "trace.js not found. Run: MemManBook --trace web/trace.js";
    return;
  }
  const EV = TRACE.events;

  // Events that only carry side data; they are applied but never become their own step.
  const QUIET = new Set(["log", "arena_reset_begin", "world_collect_begin", "monster_new", "monster_destroyed"]);
  const STEPS = [];
  EV.forEach((e, i) => { if (!QUIET.has(e.type)) STEPS.push(i); });

  const PALETTE = ["#ffb454", "#7aa2ff", "#5fd08a", "#e58cff", "#4fd1c5", "#ff8a65", "#f6d365", "#9ad0ff", "#c3e88d", "#ff9ec7"];
  const colorCache = {};
  let colorNext = 0;
  function colorOf(label) {
    if (!(label in colorCache)) colorCache[label] = PALETTE[colorNext++ % PALETTE.length];
    return colorCache[label];
  }
  // assign colours in trace order so they are stable across scrubbing
  EV.forEach(e => { if (e.label && /alloc|spawn/.test(e.type)) colorOf(e.label); });

  const $ = id => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  // ---------------------------------------------------------------- state replay
  function replay(upto) {
    const s = {
      arenas: {}, pool: null, records: [], handles: {}, ents: {}, hp: {},
      section: null, note: null, logs: [], alias: null, poolFlash: null, stale: null,
    };
    const findEnt = label => {
      let best = null;
      for (const k in s.ents) {
        const en = s.ents[k];
        if (en.label === label && en.state === "alive") best = en;
      }
      return best;
    };
    const kill = (en, i) => { if (en && en.state === "alive") { en.state = "dead"; en.diedAt = i; } };
    const place = (zone, slot, label, i) => {
      for (const k in s.ents) {
        const en = s.ents[k];
        if (en.zone === zone && en.slot === slot && en.state !== "alive") delete s.ents[k];
      }
      const max = s.hp[label] || 30;
      s.ents[zone + ":" + label + ":" + i] = { zone, slot, label, hp: max, max, state: "alive", born: i };
    };

    for (let i = 0; i <= upto; i++) {
      const e = EV[i];
      switch (e.type) {
        case "section": s.section = e; s.note = null; s.alias = null; s.poolFlash = null; s.stale = null; break;
        case "note": s.note = e.text; break;
        case "log": s.logs.push({ text: e.text, i }); break;
        case "arena_create": s.arenas[e.arena] = { name: e.arena, cap: e.cap, blocks: [], top: 0, oom: null }; break;
        case "arena_alloc": {
          const a = s.arenas[e.arena];
          a.blocks.push({ offset: e.offset, size: e.size, pad: e.pad, kind: e.kind, label: e.label, state: "live", key: e.arena + i });
          a.top = e.top; a.oom = null;
          if (e.arena === "spells" && e.kind === "Spell") {
            const n = a.blocks.filter(b => b.kind === "Spell").length - 1;
            s.ents["spells:" + e.label + ":" + i] = { zone: "spells", slot: n, label: e.label, state: "alive", spell: true, key: e.arena + i };
          }
          break;
        }
        case "arena_oom": s.arenas[e.arena].oom = e; break;
        case "arena_release": {
          const b = s.arenas[e.arena].blocks.find(b => b.offset === e.offset && b.state === "live");
          if (b) b.state = "dead";
          break;
        }
        case "arena_reset": {
          const a = s.arenas[e.arena];
          a.blocks = []; a.top = 0; a.oom = null;
          if (e.arena === "spells") for (const k in s.ents) if (s.ents[k].zone === "spells") delete s.ents[k];
          if (e.arena === "world") s.records.forEach(r => { if (r.alive) { r.alive = false; r.reset = true; } });
          break;
        }
        case "pool_create": s.pool = { name: e.pool, slots: e.slots, size: e.slot_size, occ: new Array(e.slots).fill(null), free: e.free, full: false }; break;
        case "pool_alloc": s.pool.occ[e.slot] = e.label; s.pool.free = e.free; s.poolFlash = null; place("pool", e.slot, e.label, i); break;
        case "pool_free": s.pool.occ[e.slot] = null; s.pool.free = e.free; s.pool.full = false; s.alias = null; s.poolFlash = null; break;
        case "pool_double_free": s.poolFlash = { slot: e.slot, text: "double free blocked" }; break;
        case "pool_full": s.pool.full = true; break;
        case "raw_alias": s.alias = e; break;
        case "monster_new": s.hp[e.label] = e.hp; break;
        case "monster_hit": { const en = findEnt(e.label); if (en) en.hp = e.hp; break; }
        case "monster_destroyed": kill(findEnt(e.label), i); break;
        case "world_spawn":
          s.records[e.slot] = { slot: e.slot, gen: e.gen, alive: true, label: e.label, offset: e.offset, refs: 1, genAt: -1 };
          place("world", e.slot, e.label, i);
          break;
        case "world_release": {
          const r = s.records[e.slot];
          r.alive = false; r.gen = e.gen; r.refs = 0; r.genAt = i; r.reason = e.reason;
          break;
        }
        case "handle_new": case "handle_copy":
          s.handles[e.handle] = { id: e.handle, slot: e.slot, gen: e.gen, from: e.from, dropped: false };
          if (s.records[e.slot]) s.records[e.slot].refs = e.refs;
          break;
        case "handle_drop":
          if (s.handles[e.handle]) s.handles[e.handle].dropped = true;
          if (e.valid && s.records[e.slot]) s.records[e.slot].refs = e.refs;
          break;
        case "stale_access": s.stale = e; break;
      }
    }
    return s;
  }

  // ---------------------------------------------------------------- arena strips
  const STRIP = { spells: { el: $("strip-spells"), perRow: 256 }, world: { el: $("strip-world"), perRow: 512 } };
  const ROW_H = 34, ROW_GAP = 24;

  function renderStrip(name, a, focusKeys) {
    const cfg = STRIP[name];
    const el = cfg.el;
    if (!a) { el.innerHTML = ""; el.style.height = ROW_H + "px"; return; }
    const W = el.clientWidth || 700;
    const R = cfg.perRow, rows = Math.ceil(a.cap / R), ppb = W / R;
    el.style.height = rows * ROW_H + (rows - 1) * ROW_GAP + 14 + "px";
    el.style.setProperty("--px8", (ppb * 8) + "px");

    if (el.dataset.built !== W + ":" + a.cap) {
      el.innerHTML = "";
      el.dataset.built = W + ":" + a.cap;
      for (let r = 0; r < rows; r++) {
        const row = h("div", "row");
        row.style.top = r * (ROW_H + ROW_GAP) + "px";
        row.style.width = Math.min(R, a.cap - r * R) * ppb + "px";
        el.appendChild(row);
        const step = name === "spells" ? 32 : 64;
        for (let b = 0; b <= Math.min(R, a.cap - r * R); b += step) {
          const t = h("div", "ruler", String(r * R + b));
          t.style.left = b * ppb + "px";
          t.style.top = r * (ROW_H + ROW_GAP) + ROW_H + 1 + "px";
          el.appendChild(t);
        }
      }
      const bump = h("div", "bump");
      bump.appendChild(h("span", null, "top"));
      el.appendChild(bump);
    }

    const pos = off => {
      let r = Math.floor(off / R);
      if (r >= rows) r = rows - 1;
      return { x: (off - r * R) * ppb, y: r * (ROW_H + ROW_GAP) };
    };
    // split [start, end) into per-row segments
    const segments = (start, end) => {
      const out = [];
      for (let o = start; o < end;) {
        const r = Math.floor(o / R), rowEnd = Math.min(end, (r + 1) * R);
        out.push({ start: o, end: rowEnd });
        o = rowEnd;
      }
      return out;
    };

    const want = new Map();
    a.blocks.forEach(b => {
      if (b.pad) segments(b.offset - b.pad, b.offset).forEach((sg, k) => want.set(b.key + "p" + k, { sg, cls: "block pad", title: `${b.pad} B alignment padding` }));
      segments(b.offset, b.offset + b.size).forEach((sg, k) => want.set(b.key + "s" + k, {
        sg, b, first: k === 0,
        cls: "block" + (b.state === "dead" ? " dead" : "") + (focusKeys.has(b.key) ? " hot" : ""),
        title: `${b.kind} "${b.label}"  @${b.offset}  ${b.size} B${b.state === "dead" ? "  (destroyed, bytes held until reset)" : ""}`,
      }));
    });
    if (a.oom) {
      const start = a.oom.offset + a.oom.pad, end = Math.min(start + a.oom.size, a.cap + a.oom.size);
      want.set("oom" + a.oom.seq, { sg: { start, end }, cls: "block oom", oom: a.oom, title: "does not fit" });
    }

    el.querySelectorAll(".block").forEach(n => { if (!want.has(n.dataset.key)) n.remove(); });
    want.forEach((w, key) => {
      let n = el.querySelector(`.block[data-key="${key}"]`);
      if (!n) { n = h("div"); n.dataset.key = key; el.appendChild(n); }
      n.className = w.cls;
      n.title = w.title;
      const p = pos(w.sg.start);
      n.style.left = p.x + "px";
      n.style.top = p.y + "px";
      let width = (w.sg.end - w.sg.start) * ppb;
      if (w.oom) width = Math.min(width, W - p.x + 0) ;
      n.style.width = Math.max(1, width - (w.b ? 1 : 0)) + "px";
      if (w.b) {
        n.dataset.block = w.b.key;
        n.style.backgroundColor = colorOf(w.b.label);
        n.innerHTML = w.first && width > 26
          ? `<b>${w.b.label}</b><small>${w.b.kind === "DamageRoll" ? "roll" : "@" + w.b.offset}</small>` : "";
      }
      else if (w.oom) {
        n.innerHTML = `<b>${w.oom.kind} ${w.oom.size} B</b><small>needs ${w.oom.offset}..${w.oom.offset + w.oom.size}</small>`;
      }
    });

    const bump = el.querySelector(".bump");
    const bp = a.top >= a.cap ? { x: (a.cap - (rows - 1) * R) * ppb, y: (rows - 1) * (ROW_H + ROW_GAP) } : pos(a.top);
    bump.style.left = bp.x + "px";
    bump.style.top = bp.y - 22 + "px";
    bump.querySelector("span").textContent = "top " + a.top;
  }

  // ---------------------------------------------------------------- pool
  const poolSlots = $("poolSlots"), poolArrows = $("poolArrows");
  function renderPool(s, focusSlot) {
    const p = s.pool;
    if (!p) { poolSlots.innerHTML = ""; poolArrows.innerHTML = ""; $("poolStat").textContent = "not created yet"; return; }
    if (poolSlots.children.length !== p.slots) {
      poolSlots.innerHTML = "";
      for (let i = 0; i < p.slots; i++) {
        const d = h("div", "slot");
        d.dataset.slot = i;
        d.innerHTML = `<span class="idx">slot ${i}</span><span class="off">@${i * p.size}</span><span class="who"></span>`;
        poolSlots.appendChild(d);
      }
    }
    [...poolSlots.children].forEach((d, i) => {
      const who = p.occ[i];
      d.className = "slot " + (who ? "live" : "freeslot") + (focusSlot === i ? " hot" : "");
      d.style.backgroundColor = who ? colorOf(who) : "";
      d.querySelector(".who").textContent = who || "free";
      d.querySelectorAll(".badge").forEach(b => b.remove());
      let badge = null;
      if (s.poolFlash && s.poolFlash.slot === i) { badge = s.poolFlash.text; d.classList.add("bad"); }
      if (s.alias && s.alias.slot === i) { badge = `${s.alias.name}* reads ${s.alias.actual}`; d.classList.add("bad"); }
      if (badge) d.appendChild(h("div", "badge", badge));
    });
    $("pool").classList.toggle("full", p.full);
    const live = p.occ.filter(Boolean).length;
    $("poolStat").textContent = p.full ? `FULL: ${live}/${p.slots} live, create() returned nullptr` : `${live}/${p.slots} live, ${p.free.length} free`;
    $("poolStat").style.color = p.full ? "var(--bad)" : "";

    // free-stack arrows: HEAD -> next slot create() will pop -> ...
    const base = poolSlots.offsetLeft;
    const cx = i => { const c = poolSlots.children[i]; return base + c.offsetLeft + c.offsetWidth / 2; };
    const slotBottom = poolSlots.offsetTop + poolSlots.offsetHeight;
    const pts = [{ x: 26, y: 48 }].concat(p.free.map(i => ({ x: cx(i), y: slotBottom })));
    if (!poolArrows.querySelector("defs")) {
      poolArrows.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#ffb454"/></marker></defs>`;
    }
    const arcs = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      const dip = Math.min(58, 20 + Math.abs(b.x - a.x) * 0.13);
      arcs.push(`path("M ${a.x} ${a.y} C ${a.x} ${Math.max(a.y, slotBottom) + dip}, ${b.x} ${b.y + dip}, ${b.x} ${b.y + 3}")`);
    }
    const existing = [...poolArrows.querySelectorAll("path.arc")];
    arcs.forEach((d, k) => {
      let n = existing[k];
      if (!n) { n = svg("path", { class: "arc", "marker-end": "url(#ah)" }, poolArrows); n.style.d = d; n.style.opacity = 0; n.getBoundingClientRect(); }
      n.style.d = d; n.style.opacity = 1;
    });
    existing.slice(arcs.length).forEach(n => n.remove());
    let lbl = poolArrows.querySelector("text.empty");
    if (!lbl) lbl = svg("text", { class: "empty", x: 0, y: 12 }, poolArrows);
    lbl.textContent = p.free.length ? "next pop" : "free stack empty";
  }

  // ---------------------------------------------------------------- world records + handles
  function renderWorld(s, focus) {
    const tb = $("records").querySelector("tbody");
    tb.innerHTML = "";
    s.records.forEach(r => {
      const tr = h("tr", r.alive ? "" : "dead");
      tr.dataset.rec = r.slot;
      if (focus.rec === r.slot) tr.classList.add(focus.bad ? "bad" : "hot");
      const obj = r.alive ? `<span class="swatch" style="background:${colorOf(r.label)}"></span>${r.label}`
        : `<span style="color:var(--muted)">(${r.reset ? "reset" : r.reason === "kill" ? "killed" : "collected"}: ${r.label})</span>`;
      tr.innerHTML = `<td>${r.slot}</td><td class="gen${r.genAt === cur ? " bumped" : ""}">${r.gen}</td><td>${r.alive ? r.refs : "-"}</td><td>${obj}</td><td>${r.alive ? "@" + r.offset : "-"}</td>`;
      tb.appendChild(tr);
    });
    if (!s.records.length) tb.innerHTML = `<tr><td colspan="5" style="color:var(--muted)">no records yet</td></tr>`;

    const box = $("handles");
    box.innerHTML = "";
    const live = Object.values(s.handles).filter(x => !x.dropped);
    live.forEach(x => {
      const r = s.records[x.slot];
      const valid = r && r.alive && r.gen === x.gen && !r.reset;
      const d = h("div", "handle" + (valid ? "" : " stale"));
      d.dataset.handle = x.id;
      if (focus.handle === x.id) d.classList.add(focus.bad ? "boom" : "hot");
      d.textContent = valid ? `h${x.id} → rec ${x.slot} g${x.gen} ✓` : `h${x.id} → rec ${x.slot} g${x.gen} STALE (now g${r ? r.gen : "?"})`;
      d.title = valid ? `points at ${r.label}` : "generation mismatch: the object this handle was made for is gone";
      box.appendChild(d);
    });
    if (!live.length) box.appendChild(h("div", "stat", "none"));
    const w = s.arenas.world;
    $("worldStat").textContent = w ? `${w.top}/${w.cap} B bumped, ${w.blocks.filter(b => b.state === "dead").length} dead hole(s)` : "not created yet";
    const sp = s.arenas.spells;
    $("spellsStat").textContent = sp ? `${sp.top}/${sp.cap} B used, ${sp.blocks.length} object(s)` : "";
  }

  // ---------------------------------------------------------------- game view
  const game = $("game");
  const HERO = { x: 58, y: 160 };
  function entPos(en) {
    if (en.zone === "pool") return { x: 175 + (en.slot % 3) * 88, y: 100 + Math.floor(en.slot / 3) * 118 };
    if (en.zone === "world") return { x: 180 + (en.slot % 3) * 86, y: 160 + Math.floor(en.slot / 3) * 100 };
    return { x: 175 + (en.slot % 3) * 88, y: 95 + Math.floor(en.slot / 3) * 110 };
  }
  function buildGame() {
    game.innerHTML = "";
    const floor = svg("g", {}, game);
    for (let x = 0; x < 420; x += 30) for (let y = 20; y < 300; y += 30) svg("rect", { class: "floor", x, y, width: 30, height: 30 }, floor);
    svg("text", { class: "zone", x: 12, y: 14, id: "zone" }, game);
    const hero = svg("g", { transform: `translate(${HERO.x},${HERO.y})`, id: "hero" }, game);
    svg("path", { d: "M-14 26 L0 -6 L14 26 Z", fill: "#7aa2ff", stroke: "#0b0d12", "stroke-width": 2 }, hero);
    svg("circle", { cx: 0, cy: -14, r: 10, fill: "#f2d3b1", stroke: "#0b0d12", "stroke-width": 2 }, hero);
    svg("path", { d: "M12 4 L30 -18", stroke: "#e6e8ef", "stroke-width": 3, "stroke-linecap": "round" }, hero);
    svg("text", { y: 44, "text-anchor": "middle", fill: "#e6e8ef", "font-size": 11, "font-weight": 600 }, hero).textContent = "Hero";
    svg("g", { id: "ents" }, game);
    svg("g", { id: "fx" }, game);
  }
  buildGame();

  function renderGame(s, focusEnt) {
    const zone = s.section ? { Arena: "spells", Pool: "pool", World: "world" }[s.section.title] : "spells";
    $("zone").textContent = { spells: "SPELLS LIVE IN THE ARENA", pool: "EACH MONSTER OWNS A POOL SLOT", world: "MONSTERS BEHIND world_ptr RECORDS" }[zone];
    const layer = $("ents");
    const want = {};
    for (const k in s.ents) if (s.ents[k].zone === zone) want[k] = s.ents[k];
    [...layer.children].forEach(n => { if (!want[n.dataset.key]) n.remove(); });
    for (const k in want) {
      const en = want[k];
      let g = layer.querySelector(`[data-key="${CSS.escape(k)}"]`);
      const p = entPos(en);
      if (!g) {
        g = svg("g", { class: "mon" }, layer);
        g.dataset.key = k;
        const inner = svg("g", { class: "spawn" }, g);
        const col = colorOf(en.label);
        if (en.spell) {
          svg("circle", { class: "ring", r: 18 }, inner);
          svg("circle", { class: "body", r: 12, fill: col }, inner);
          svg("circle", { r: 5, fill: "#fff", opacity: .7 }, inner);
          svg("text", { class: "name", y: 28 }, inner).textContent = en.label;
        }
        else {
          const r = 17 + Math.min(10, (en.max || 30) / 22);
          g.dataset.r = r;
          svg("circle", { class: "ring", r: r + 6 }, inner);
          svg("path", { class: "body", fill: col, d: `M${-r} 4 Q${-r} ${-r} 0 ${-r} Q${r} ${-r} ${r} 4 L${r} ${r * .8} L${r * .5} ${r * .45} L0 ${r * .8} L${-r * .5} ${r * .45} L${-r} ${r * .8} Z` }, inner);
          svg("circle", { cx: -r * .35, cy: -r * .2, r: 3.2, fill: "#0b0d12" }, inner);
          svg("circle", { cx: r * .35, cy: -r * .2, r: 3.2, fill: "#0b0d12" }, inner);
          svg("rect", { x: -22, y: -r - 12, width: 44, height: 5, rx: 2, fill: "#2b3042" }, inner);
          svg("rect", { class: "hp", x: -22, y: -r - 12, width: 44, height: 5, rx: 2, fill: "#5fd08a" }, inner);
          svg("text", { class: "name", y: r + 16 }, inner).textContent = en.label;
          svg("text", { class: "tag", y: r + 28 }, inner);
          const x = svg("g", { class: "x", opacity: 0 }, inner);
          svg("path", { class: "xmark", d: "M-10 -10 L10 10 M10 -10 L-10 10" }, x);
        }
        g.addEventListener("mouseenter", () => { hoverKey = k; drawLinks(); });
        g.addEventListener("mouseleave", () => { hoverKey = null; drawLinks(); });
      }
      g.style.transform = `translate(${p.x}px, ${p.y}px)`;
      g.classList.toggle("dead", en.state !== "alive");
      g.classList.toggle("hot", focusEnt === k);
      const hp = g.querySelector(".hp");
      if (hp) {
        hp.setAttribute("width", Math.max(0, 44 * en.hp / en.max));
        hp.setAttribute("fill", en.hp / en.max > .5 ? "#5fd08a" : en.hp / en.max > .2 ? "#ffb454" : "#ff5d6c");
      }
      const tag = g.querySelector(".tag");
      if (tag) {
        if (en.zone === "pool") tag.textContent = `slot ${en.slot} @${en.slot * (s.pool ? s.pool.size : 40)}`;
        else { const r = s.records[en.slot]; tag.textContent = `rec ${en.slot} gen ${r && r.label === en.label && r.alive ? r.gen : "-"}`; }
      }
      const x = g.querySelector(".x");
      if (x) x.setAttribute("opacity", en.state === "alive" ? 0 : 1);
    }
  }

  function fx(e, s) {
    const layer = $("fx");
    if (e.type === "monster_hit") {
      const k = Object.keys(s.ents).find(k => s.ents[k].label === e.label && (s.ents[k].state === "alive" || s.ents[k].diedAt >= 0));
      if (!k) return;
      const p = entPos(s.ents[k]);
      const line = svg("line", { class: "slash", x1: HERO.x + 28, y1: HERO.y - 16, x2: p.x - 10, y2: p.y }, layer);
      const t = svg("text", { class: "dmg", x: p.x + 18, y: p.y - 30 }, layer);
      t.textContent = "-" + e.damage;
      setTimeout(() => { line.remove(); t.remove(); }, 950);
    }
    if (e.type === "stale_access") {
      const p = entPos({ zone: "world", slot: e.slot });
      const t = svg("text", { class: "alarm", x: p.x, y: p.y - 48 }, layer);
      t.textContent = "DANGLING h" + e.handle + " CAUGHT";
      setTimeout(() => t.remove(), 1700);
    }
    if (e.type === "arena_reset" && STRIP[e.arena]) {
      const el = STRIP[e.arena].el;
      el.querySelectorAll(".row").forEach(r => {
        const sw = h("div", "sweep");
        sw.style.top = r.style.top; sw.style.left = "0px"; sw.style.width = r.style.width;
        el.appendChild(sw);
        setTimeout(() => sw.remove(), 650);
      });
    }
  }

  // ---------------------------------------------------------------- focus + link lines
  let hoverKey = null, lastState = null, lastFocus = null;

  function entKeyFor(s, zone, label) {
    let best = null;
    for (const k in s.ents) if (s.ents[k].zone === zone && s.ents[k].label === label) best = k;
    return best;
  }

  function focusFor(s, e) {
    const f = { blocks: new Set(), slot: null, rec: null, handle: null, ent: null, chain: [], bad: false };
    const blockAt = (arena, off) => {
      const a = s.arenas[arena];
      const b = a && a.blocks.slice().reverse().find(b => b.offset === off);
      return b ? b.key : null;
    };
    switch (e.type) {
      case "arena_alloc": {
        const k = blockAt(e.arena, e.offset);
        if (k) f.blocks.add(k);
        f.chain = [["block", k]];
        if (e.arena === "spells") { f.ent = entKeyFor(s, "spells", e.label); f.chain.push(["ent", f.ent]); }
        break;
      }
      case "arena_oom": f.chain = [["oom", e.arena]]; f.bad = true; break;
      case "world_spawn": case "world_release": {
        const k = blockAt("world", e.offset);
        if (k) f.blocks.add(k);
        f.rec = e.slot;
        const label = e.label || (s.records[e.slot] && s.records[e.slot].label);
        f.ent = entKeyFor(s, "world", label);
        f.chain = [["block", k], ["rec", e.slot], ["ent", f.ent]];
        break;
      }
      case "pool_alloc": case "pool_free":
        f.slot = e.slot; f.ent = entKeyFor(s, "pool", e.label);
        f.chain = [["slot", e.slot], ["ent", f.ent]];
        break;
      case "raw_alias":
        f.slot = e.slot; f.bad = true; f.ent = entKeyFor(s, "pool", e.actual);
        f.chain = [["slot", e.slot], ["ent", f.ent]];
        break;
      case "pool_double_free": f.slot = e.slot; f.bad = true; f.chain = [["slot", e.slot]]; break;
      case "handle_new": case "handle_copy": case "handle_drop":
        f.handle = e.handle; f.rec = e.slot;
        f.chain = e.type === "handle_drop" ? [["rec", e.slot]] : [["handle", e.handle], ["rec", e.slot]];
        break;
      case "stale_access": {
        f.handle = e.handle; f.rec = e.slot; f.bad = true;
        const r = s.records[e.slot];
        f.ent = r ? entKeyFor(s, "world", r.label) : null;
        f.chain = [["handle", e.handle], ["rec", e.slot], ["ent", f.ent]];
        break;
      }
      case "monster_hit": {
        const zone = s.section && s.section.title === "Pool" ? "pool" : "world";
        f.ent = entKeyFor(s, zone, e.label);
        const en = f.ent && s.ents[f.ent];
        if (en && zone === "pool") { f.slot = en.slot; f.chain = [["ent", f.ent], ["slot", en.slot]]; }
        if (en && zone === "world") {
          f.rec = en.slot;
          const r = s.records[en.slot];
          const k = r && blockAt("world", r.offset);
          if (k) f.blocks.add(k);
          f.chain = [["ent", f.ent], ["rec", en.slot], ["block", k]];
        }
        break;
      }
    }
    return f;
  }

  function anchorEl(kind, id) {
    if (id == null) return null;
    switch (kind) {
      case "block": return document.querySelector(`.block[data-block="${id}"]`);
      case "oom": return STRIP[id] && STRIP[id].el.querySelector(".block.oom");
      case "slot": return poolSlots.children[id];
      case "rec": return document.querySelector(`#records tr[data-rec="${id}"]`);
      case "handle": return document.querySelector(`.handle[data-handle="${id}"]`);
      case "ent": { const g = $("ents").querySelector(`[data-key="${CSS.escape(id)}"]`); return g && (g.querySelector(".body") || g); }
    }
    return null;
  }

  function drawLinks() {
    const layer = $("links");
    layer.innerHTML = "";
    if (!lastState) return;
    let chain = lastFocus ? lastFocus.chain : [];
    let bad = lastFocus && lastFocus.bad;
    if (hoverKey && lastState.ents[hoverKey]) {
      const en = lastState.ents[hoverKey];
      bad = false;
      if (en.zone === "pool") chain = [["ent", hoverKey], ["slot", en.slot]];
      else if (en.zone === "spells") chain = [["ent", hoverKey], ["block", en.key]];
      else {
        const r = lastState.records[en.slot];
        const b = r && lastState.arenas.world && lastState.arenas.world.blocks.find(b => b.offset === r.offset && b.label === en.label);
        chain = [["ent", hoverKey], ["rec", en.slot], ["block", b && b.key]];
      }
    }
    const rects = chain.map(([k, id]) => anchorEl(k, id)).filter(Boolean).map(el => el.getBoundingClientRect())
      .filter(r => r.width || r.height);
    for (let i = 0; i + 1 < rects.length; i++) {
      const a = rects[i], b = rects[i + 1];
      const A = edge(a, b), B = edge(b, a);
      const dx = (B.x - A.x) * 0.45;
      svg("path", { class: bad ? "bad" : "", d: `M ${A.x} ${A.y} C ${A.x + dx} ${A.y}, ${B.x - dx} ${B.y}, ${B.x} ${B.y}` }, layer);
      svg("circle", { cx: A.x, cy: A.y, r: 3 }, layer);
      svg("circle", { cx: B.x, cy: B.y, r: 3 }, layer);
    }
  }
  function edge(r, to) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const tx = to.left + to.width / 2, ty = to.top + to.height / 2;
    if (Math.abs(tx - cx) > Math.abs(ty - cy) * 1.2) return { x: tx > cx ? r.right : r.left, y: cy };
    return { x: cx, y: ty > cy ? r.bottom : r.top };
  }

  // ---------------------------------------------------------------- frame
  let step = 0, cur = STEPS[0], playing = false, timer = null;

  function render(prevIdx) {
    cur = STEPS[step];
    const e = EV[cur];
    const s = replay(cur);
    const f = focusFor(s, e);
    lastState = s; lastFocus = f;

    const sec = s.section ? s.section.title : "Arena";
    $("sectionChip").textContent = sec;
    $("captionText").textContent = s.note || (s.section ? s.section.text : "");
    ["spells", "pool", "world"].forEach(p => {
      const on = { Arena: "spells", Pool: "pool", World: "world" }[sec] === p;
      $("panel-" + p).classList.toggle("dim", !on);
      $("panel-" + p).classList.toggle("focus", on);
    });
    document.querySelectorAll("#sections button").forEach(b => b.classList.toggle("on", b.dataset.sec === sec));

    renderStrip("spells", s.arenas.spells, f.blocks);
    renderStrip("world", s.arenas.world, f.blocks);
    renderPool(s, f.slot);
    renderWorld(s, f);
    renderGame(s, f.ent);

    const log = $("log");
    log.innerHTML = "";
    const since = prevIdx != null && prevIdx < cur ? prevIdx : (step > 0 ? STEPS[step - 1] : -1);
    s.logs.slice(-10).forEach(l => log.appendChild(h("div", l.i > since ? "new" : "", l.text)));
    $("evType").textContent = e.type;
    const shown = Object.assign({}, e);
    $("raw").textContent = JSON.stringify(shown);

    $("scrub").value = step;
    $("counter").textContent = `${step + 1} / ${STEPS.length}`;
    $("play").textContent = playing ? "Pause" : "Play";

    if (prevIdx != null && cur > prevIdx && cur - prevIdx < 40) {
      for (let i = prevIdx + 1; i <= cur; i++) fx(EV[i], s);
    }
    drawLinks();
    setTimeout(drawLinks, 480);
  }

  function go(n, animate) {
    const prev = cur;
    step = Math.max(0, Math.min(STEPS.length - 1, n));
    render(animate ? prev : null);
  }

  function delayFor(idx) {
    const t = EV[idx].type;
    const speed = parseFloat($("speed").value);
    const base = t === "note" ? 2600 : t === "section" ? 2400 : 1000;
    return base / speed;
  }
  function tick() {
    if (!playing) return;
    if (step >= STEPS.length - 1) { playing = false; render(); return; }
    go(step + 1, true);
    timer = setTimeout(tick, delayFor(STEPS[step]));
  }
  function setPlaying(on) {
    playing = on;
    clearTimeout(timer);
    if (on) {
      if (step >= STEPS.length - 1) go(0);
      timer = setTimeout(tick, 500);
    }
    $("play").textContent = playing ? "Pause" : "Play";
  }

  // section jump buttons
  const secBox = $("sections");
  STEPS.forEach((idx, k) => {
    if (EV[idx].type !== "section") return;
    const b = h("button", null, EV[idx].title);
    b.dataset.sec = EV[idx].title;
    b.addEventListener("click", () => { setPlaying(false); go(k); });
    secBox.appendChild(b);
  });

  $("scrub").max = STEPS.length - 1;
  $("scrub").addEventListener("input", ev => { setPlaying(false); go(+ev.target.value); });
  $("prev").addEventListener("click", () => { setPlaying(false); go(step - 1); });
  $("next").addEventListener("click", () => { setPlaying(false); go(step + 1, true); });
  $("play").addEventListener("click", () => setPlaying(!playing));
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT") return;
    if (ev.key === "ArrowRight") { setPlaying(false); go(step + 1, true); }
    else if (ev.key === "ArrowLeft") { setPlaying(false); go(step - 1); }
    else if (ev.key === " ") { ev.preventDefault(); setPlaying(!playing); }
  });
  window.addEventListener("resize", () => render());

  const params = new URLSearchParams(location.search);
  go(parseInt(params.get("step") || "0", 10) || 0);
  if (params.get("autoplay") === "1") setPlaying(true);

  // hooks for scripted recordings
  window.memman = { go: n => go(n, true), step: () => step, steps: STEPS.length, stepOfSeq: seq => STEPS.findIndex(i => i >= seq), setPlaying };
})();
