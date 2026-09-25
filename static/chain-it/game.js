// Chain It — a word chain game.
// Player 1 opens with any word; each next word must start with the last
// letter of the previous one, against a turn clock.
(() => {
  "use strict";

  const WORDS = window.CHAIN_IT_WORDS || [];
  const WORDSET = new Set(WORDS);
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "chain-it:setup";

  // Letters that start few English words. Ending on one pressures the next player.
  const END_BONUS = { x: 6, q: 6, z: 5, j: 5, k: 3, y: 3, v: 3, u: 2, i: 1, o: 1, n: 1 };
  const TRAP_POOL = ["e", "s", "t", "y", "d", "r", "n"];
  const TIMEOUT_PENALTY = 3;

  const MODES = [
    {
      id: "classic", glyph: "A→A", name: "Classic",
      desc: "Start with the last letter. Lose a life when the clock runs out.",
      guide: "The standard game. Last player with lives left wins.",
    },
    {
      id: "long", glyph: "AB→AB", name: "Long Chain",
      desc: "Start with the last two letters. Based on the Balkan game Kalodont.",
      guide: "Every word must begin with the last two letters of the previous word (tiger → error → organ). Words need at least 3 letters.",
    },
    {
      id: "sudden", glyph: "10→3", name: "Sudden Death",
      desc: "The clock loses a second every turn, down to 3 seconds.",
      guide: "Starts at your chosen time and shrinks by one second each turn until it bottoms out at 3 seconds.",
    },
    {
      id: "climb", glyph: "3+", name: "Length Climb",
      desc: "Minimum word length goes up every 4 words.",
      guide: "Starts at 3 letters, then the minimum rises by one every 4 accepted words (up to 8).",
    },
    {
      id: "trap", glyph: "¬E", name: "Trap Letter",
      desc: "One banned ending letter. End on it and you lose a life. Inspired by Shiritori.",
      guide: "In Japanese Shiritori, a word ending in ん loses because no word starts with it. Here a random common letter is banned as an ending each game.",
    },
    {
      id: "points", glyph: "+PTS", name: "Points",
      desc: "No knockouts. Score by word length plus a bonus for hard endings.",
      guide: "Each word scores its length, plus a bonus for ending on a hard letter (X and Q +6, Z and J +5, K, Y and V +3). A timeout costs 3 points. Highest score after the set rounds wins.",
    },
  ];

  // ---------- state ----------
  let setup = loadSetup();
  let G = null;           // current game
  let raf = 0;
  let cpuTimer = 0;
  let audio = null;
  let lastTickSec = -1;

  // ---------- setup screen ----------
  function defaultSetup() {
    return {
      players: [{ name: "Player 1", cpu: false }, { name: "Player 2", cpu: false }],
      cpuLevel: "normal",
      mode: "classic",
      time: 10,
      lives: 3,
      rounds: 5,
      dict: true,
      handoff: true,
      sound: true,
    };
  }

  function loadSetup() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = Object.assign(defaultSetup(), JSON.parse(raw));
        if (Array.isArray(s.players) && s.players.length) return s;
      }
    } catch (e) { /* storage unavailable */ }
    return defaultSetup();
  }

  function saveSetup() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(setup)); } catch (e) { /* ignore */ }
  }

  function renderModes() {
    $("modes").innerHTML = MODES.map((m) => `
      <label class="mode">
        <input type="radio" name="mode" id="mode-${m.id}" value="${m.id}" ${m.id === setup.mode ? "checked" : ""}>
        <span class="mode-card">
          <span class="glyph">${m.glyph}</span>
          <span class="name">${m.name}</span>
          <span class="desc">${m.desc}</span>
        </span>
      </label>`).join("");
    $("guide-modes").innerHTML = MODES.map((m) => `<dt>${m.name}</dt><dd>${m.guide}</dd>`).join("");
  }

  function renderPlayersEdit() {
    const list = $("players-edit");
    list.innerHTML = "";
    setup.players.forEach((p, i) => {
      const li = document.createElement("li");
      const input = document.createElement("input");
      input.id = `pname-${i}`;
      input.value = p.name;
      input.maxLength = 16;
      input.setAttribute("aria-label", `Player ${i + 1} name`);
      input.addEventListener("input", () => { p.name = input.value; saveSetup(); });
      li.appendChild(input);
      if (p.cpu) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "CPU";
        li.appendChild(tag);
      }
      if (setup.players.length > 1) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "btn ghost remove";
        rm.textContent = "✕";
        rm.setAttribute("aria-label", `Remove ${p.name || "player"}`);
        rm.addEventListener("click", () => { setup.players.splice(i, 1); saveSetup(); renderPlayersEdit(); });
        li.appendChild(rm);
      }
      list.appendChild(li);
    });
    const full = setup.players.length >= 6;
    $("add-player").disabled = full;
    $("add-cpu").disabled = full;
    $("cpu-level-field").hidden = !setup.players.some((p) => p.cpu);
  }

  function syncSetupFields() {
    $("cpu-level").value = setup.cpuLevel;
    $("time-limit").value = String(setup.time);
    $("lives").value = String(setup.lives);
    $("rounds").value = String(setup.rounds);
    $("opt-dict").checked = setup.dict;
    $("opt-handoff").checked = setup.handoff;
    $("opt-sound").checked = setup.sound;
    syncModeFields();
  }

  function syncModeFields() {
    const points = setup.mode === "points";
    $("lives-field").hidden = points;
    $("rounds-field").hidden = !points;
    $("time-label").textContent = setup.mode === "sudden" ? "Starting time" : "Time per turn";
  }

  function bindSetup() {
    $("add-player").addEventListener("click", () => {
      const n = setup.players.filter((p) => !p.cpu).length + 1;
      setup.players.push({ name: `Player ${n}`, cpu: false });
      saveSetup(); renderPlayersEdit();
    });
    $("add-cpu").addEventListener("click", () => {
      const n = setup.players.filter((p) => p.cpu).length + 1;
      setup.players.push({ name: n === 1 ? "Computer" : `Computer ${n}`, cpu: true });
      saveSetup(); renderPlayersEdit();
    });
    $("modes").addEventListener("change", (e) => {
      if (e.target.name === "mode") { setup.mode = e.target.value; syncModeFields(); saveSetup(); }
    });
    const bindSel = (id, key, num) => $(id).addEventListener("change", (e) => {
      setup[key] = num ? Number(e.target.value) : e.target.value; saveSetup();
    });
    bindSel("cpu-level", "cpuLevel");
    bindSel("time-limit", "time", true);
    bindSel("lives", "lives", true);
    bindSel("rounds", "rounds", true);
    const bindChk = (id, key) => $(id).addEventListener("change", (e) => { setup[key] = e.target.checked; saveSetup(); });
    bindChk("opt-dict", "dict");
    bindChk("opt-handoff", "handoff");
    bindChk("opt-sound", "sound");
    $("setup-form").addEventListener("submit", (e) => { e.preventDefault(); startGame(); });
  }

  // ---------- game ----------
  function startGame() {
    unlockAudio();
    const s = setup;
    G = {
      mode: s.mode,
      baseTime: s.time,
      maxLives: s.mode === "points" ? 0 : s.lives,
      rounds: s.rounds,
      dict: s.dict,
      handoff: s.handoff,
      cpuLevel: s.cpuLevel,
      players: s.players.map((p, i) => ({
        name: (p.name || "").trim() || (p.cpu ? "Computer" : `Player ${i + 1}`),
        cpu: p.cpu,
        lives: s.lives,
        score: 0,
        out: false,
        words: 0,
      })),
      chain: [],            // {word, by, verified, pts} or {system:true, text}
      used: new Set(),
      turn: 0,
      turnCount: 0,         // turns taken (accepted, timed out or trapped)
      accepted: 0,          // accepted words
      trap: s.mode === "trap" ? TRAP_POOL[Math.floor(Math.random() * TRAP_POOL.length)] : null,
      deadline: 0,
      turnMs: 0,
      pausedLeft: null,
      phase: "idle",        // idle | handoff | play | checking | over
      lastHuman: null,
    };
    showScreen("play");
    $("chain").innerHTML = "";
    renderAll();
    beginTurn(true);
  }

  const words = () => G.chain.filter((c) => !c.system);
  const lastWord = () => { const w = words().filter((c) => !c.trapped); return w.length ? w[w.length - 1] : null; };
  const linkLen = () => (G.mode === "long" ? 2 : 1);

  function needed() {
    const lw = lastWord();
    return lw ? lw.word.slice(-linkLen()) : "";
  }

  function minLen() {
    if (G.mode === "climb") return Math.min(8, 3 + Math.floor(G.accepted / 4));
    if (G.mode === "long") return 3;
    return 2;
  }

  function turnSeconds() {
    if (G.mode === "sudden") return Math.max(3, G.baseTime - G.turnCount);
    return G.baseTime;
  }

  const alive = () => G.players.filter((p) => !p.out);

  function nextPlayerIndex(from) {
    const n = G.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (!G.players[i].out) return i;
    }
    return from;
  }

  function beginTurn(first) {
    if (checkGameOver()) return;
    const p = G.players[G.turn];
    G.turnMs = turnSeconds() * 1000;
    G.pausedLeft = G.turnMs;
    renderAll();
    const humans = G.players.filter((x) => !x.cpu).length;
    const needHandoff = G.handoff && !p.cpu && humans > 1 && G.lastHuman !== G.turn && !(first && G.turn === 0);
    if (needHandoff) {
      G.phase = "handoff";
      $("handoff-name").textContent = p.name;
      const need = needed();
      $("handoff-need").innerHTML = need
        ? `Your word starts with <b>${esc(need)}</b>`
        : "You open the chain with any word.";
      $("handoff").hidden = false;
      $("ready-btn").focus();
      stopClock();
      paintClock();
    } else {
      startClock();
    }
  }

  function startClock() {
    const p = G.players[G.turn];
    $("handoff").hidden = true;
    G.phase = "play";
    G.deadline = performance.now() + G.pausedLeft;
    G.pausedLeft = null;
    lastTickSec = -1;
    renderTurn();
    if (p.cpu) {
      cpuPlay();
    } else {
      G.lastHuman = G.turn;
      const input = $("word-input");
      input.value = "";
      input.focus({ preventScroll: true });
    }
    loop();
  }

  function pauseClock() {
    if (G.phase !== "play") return;
    G.pausedLeft = Math.max(0, G.deadline - performance.now());
    G.phase = "checking";
    stopClock();
    paintClock();
  }

  function resumeClock() {
    if (!G || G.phase !== "checking") return;
    G.phase = "play";
    G.deadline = performance.now() + G.pausedLeft;
    G.pausedLeft = null;
    loop();
  }

  function stopClock() { cancelAnimationFrame(raf); raf = 0; }

  function timeLeft() {
    if (G.pausedLeft != null) return G.pausedLeft;
    return Math.max(0, G.deadline - performance.now());
  }

  function loop() {
    stopClock();
    const tick = () => {
      if (!G || G.phase !== "play") return;
      const left = timeLeft();
      paintClock();
      const sec = Math.ceil(left / 1000);
      if (sec <= 3 && sec > 0 && sec !== lastTickSec) { lastTickSec = sec; beep(880, 0.05, 0.05); }
      if (left <= 0) { onTimeout(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function paintClock() {
    const left = timeLeft();
    const frac = G.turnMs ? left / G.turnMs : 0;
    $("clock-fill").style.strokeDashoffset = String(100 * (1 - frac));
    $("secs").textContent = `${(left / 1000).toFixed(1)}s`;
    const clock = $("clock");
    clock.classList.toggle("low", G.phase === "play" && left <= 3000);
    clock.classList.toggle("paused", G.phase !== "play");
  }

  // ---------- turns ----------
  function onTimeout() {
    stopClock();
    clearTimeout(cpuTimer);
    const p = G.players[G.turn];
    beep(160, 0.35, 0.12, "sawtooth");
    penalize(p, "ran out of time");
    endTurn();
  }

  function penalize(p, reason) {
    if (G.mode === "points") {
      p.score -= TIMEOUT_PENALTY;
      addSystem(`${p.name} ${reason}. −${TIMEOUT_PENALTY} points.`);
    } else {
      p.lives -= 1;
      if (p.lives <= 0) {
        p.out = true;
        addSystem(`${p.name} ${reason} and is out.`);
      } else {
        addSystem(`${p.name} ${reason}. ${p.lives} ${p.lives === 1 ? "life" : "lives"} left.`);
      }
    }
    G.turnCount += 1;
  }

  function endTurn() {
    G.turn = nextPlayerIndex(G.turn);
    setMsg("");
    beginTurn(false);
  }

  function checkGameOver() {
    if (!G || G.phase === "over") return true;
    if (G.mode === "points") {
      if (G.turnCount >= G.rounds * G.players.length) { gameOver(); return true; }
      return false;
    }
    const left = alive().length;
    if (G.players.length === 1 ? left === 0 : left <= 1) { gameOver(); return true; }
    return false;
  }

  // Rule checks that don't need a dictionary. Returns an error string or "".
  function ruleError(w) {
    if (!/^[a-z]+$/.test(w)) return "Letters only, no spaces or symbols.";
    const need = needed();
    if (need && !w.startsWith(need)) return `It has to start with “${need.toUpperCase()}”.`;
    if (w.length < minLen()) return `Words need at least ${minLen()} letters right now.`;
    if (G.used.has(w)) return `“${w}” is already in the chain.`;
    return "";
  }

  async function submitWord(raw) {
    if (!G || G.phase !== "play") return;
    const p = G.players[G.turn];
    if (p.cpu) return;
    const w = raw.trim().toLowerCase();
    if (!w) return;
    const err = ruleError(w);
    if (err) { reject(err); return; }

    let verified = WORDSET.has(w);
    if (!verified && G.dict) {
      pauseClock();
      setMsg("Checking the dictionary…");
      const res = await lookup(w);
      if (!G || G.phase !== "checking") return;
      if (res === false) { resumeClock(); reject(`“${w}” isn't in the dictionary.`); return; }
      verified = res === true;
      resumeClock();
    }
    accept(w, verified);
  }

  function reject(text) {
    setMsg(text, "bad");
    beep(220, 0.12, 0.08, "square");
    const f = $("entry-form");
    f.classList.remove("shake");
    void f.offsetWidth;
    f.classList.add("shake");
    $("word-input").select();
  }

  function accept(w, verified) {
    stopClock();
    const p = G.players[G.turn];
    const player = G.turn;
    if (G.trap && w.endsWith(G.trap)) {
      G.used.add(w);
      G.chain.push({ word: w, by: player, verified, pts: 0, trapped: true });
      beep(160, 0.35, 0.12, "sawtooth");
      penalize(p, `ended on the banned letter ${G.trap.toUpperCase()}`);
      // The trapped word doesn't count as a link; the next player keeps the old letter.
      renderChain();
      $("word-input").value = "";
      endTurn();
      return;
    }
    const pts = G.mode === "points" ? w.length + (END_BONUS[w.slice(-1)] || 0) : 0;
    p.score += pts;
    p.words += 1;
    G.used.add(w);
    G.chain.push({ word: w, by: player, verified, pts });
    G.accepted += 1;
    G.turnCount += 1;
    beep(660, 0.08, 0.06);
    setTimeout(() => beep(990, 0.1, 0.05), 70);
    $("word-input").value = "";
    endTurn();
    if (!verified) setMsg(`“${w}” couldn't be checked. Anyone can challenge it.`);
  }

  // Online dictionary lookup: true = real word, false = not found, null = couldn't check.
  async function lookup(w) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, { signal: ctrl.signal });
      if (r.ok) return true;
      if (r.status === 404) return false;
      return null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  // Remove the latest unverified word; its player is penalized and the
  // current player replays from the previous letter with a fresh clock.
  function challenge() {
    if (!G || (G.phase !== "play" && G.phase !== "handoff")) return;
    const idx = G.chain.length - 1;
    const entry = G.chain[idx];
    if (!entry || entry.system || entry.verified || entry.trapped) return;
    stopClock();
    clearTimeout(cpuTimer);
    G.chain.splice(idx, 1);
    G.used.delete(entry.word);
    G.accepted -= 1;
    const author = G.players[entry.by];
    author.score -= entry.pts;
    author.words -= 1;
    penalize(author, `was challenged on “${entry.word}”`);
    G.turnCount -= 1; // the author's turn was already counted when the word was accepted
    if (author.out && G.turn === entry.by) G.turn = nextPlayerIndex(G.turn);
    G.lastHuman = null;
    setMsg("");
    beginTurn(false);
  }

  // ---------- computer player ----------
  function cpuPlay() {
    const level = G.cpuLevel;
    const secs = G.turnMs / 1000;
    const think = level === "easy" ? [0.35, 0.8] : level === "hard" ? [0.12, 0.4] : [0.2, 0.6];
    const delay = secs * 1000 * (think[0] + Math.random() * (think[1] - think[0]));
    const freezeChance = level === "easy" ? 0.18 : level === "normal" ? 0.06 : 0.02;
    setMsg(`${G.players[G.turn].name} is thinking…`);
    clearTimeout(cpuTimer);
    if (Math.random() < freezeChance) return; // blanks and lets the clock run out
    cpuTimer = setTimeout(() => {
      if (!G || G.phase !== "play" || !G.players[G.turn].cpu) return;
      const w = cpuPick(level);
      if (w) { setMsg(""); accept(w, true); }
    }, Math.max(0, Math.min(delay, timeLeft() - 400)));
  }

  function cpuPick(level) {
    const need = needed();
    const min = minLen();
    const ok = WORDS.filter((w) => w.startsWith(need) && w.length >= min && !G.used.has(w) && !(G.trap && w.endsWith(G.trap)));
    if (!ok.length) return null;
    if (level !== "hard") return ok[Math.floor(Math.random() * ok.length)];
    // Hard: pick the word that leaves the next player the fewest options.
    const L = linkLen();
    const nextMin = G.mode === "climb" ? Math.min(8, 3 + Math.floor((G.accepted + 1) / 4)) : min;
    const options = (w) => {
      const next = w.slice(-L);
      let n = 0;
      for (const x of WORDS) if (x !== w && x.startsWith(next) && x.length >= nextMin && !G.used.has(x)) n++;
      return n;
    };
    let best = null, bestN = Infinity;
    for (const w of ok) {
      const n = options(w) + Math.random() * 0.5;
      if (n < bestN) { bestN = n; best = w; }
    }
    return best;
  }

  // ---------- game over ----------
  function gameOver(quit) {
    stopClock();
    clearTimeout(cpuTimer);
    G.phase = "over";
    $("handoff").hidden = true;
    $("confirm-quit").hidden = true;
    const ws = words().filter((c) => !c.trapped);
    let ranked;
    if (G.mode === "points") {
      ranked = G.players.slice().sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const tie = ranked.length > 1 && ranked[1].score === top.score;
      $("winner").textContent = tie ? "It's a tie" : `${top.name} wins`;
    } else if (G.players.length === 1) {
      ranked = G.players.slice();
      $("winner").textContent = `${ws.length} ${ws.length === 1 ? "link" : "links"}`;
    } else {
      // Survivors first, then the order players were knocked out (latest first).
      ranked = G.players.slice().sort((a, b) => (a.out - b.out) || (b.lives - a.lives) || (b.words - a.words));
      const left = alive();
      if (left.length === 1) $("winner").textContent = `${left[0].name} wins`;
      else if (!left.length) $("winner").textContent = "Nobody survived";
      else $("winner").textContent = quit ? "Game ended early" : `${ranked[0].name} wins`;
    }
    const longest = ws.reduce((a, c) => (c.word.length > (a ? a.word.length : 0) ? c : a), null);
    $("stats").innerHTML = [
      stat("Chain length", `${ws.length} ${ws.length === 1 ? "word" : "words"}`),
      stat("Longest word", longest ? `${longest.word} (${longest.word.length})` : "none"),
      stat("Mode", MODES.find((m) => m.id === G.mode).name + (G.trap ? ` · no “${G.trap.toUpperCase()}”` : "")),
    ].join("");
    $("standings").innerHTML = ranked.map((p, i) => `
      <li><span><span class="r">${i + 1}</span>&nbsp; ${esc(p.name)}</span>
      <span>${G.mode === "points" ? `${p.score} pts` : `${p.words} ${p.words === 1 ? "word" : "words"}`}</span></li>`).join("");
    $("final-chain").innerHTML = ws.length
      ? ws.map((c) => `<span>${esc(c.word)}</span>`).join("<i>→</i>")
      : "No words were played.";
    showScreen("over");
  }

  const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`;

  // ---------- rendering ----------
  function renderAll() { renderScoreboard(); renderChain(); renderTurn(); }

  function renderScoreboard() {
    $("scoreboard").innerHTML = G.players.map((p, i) => {
      const val = G.mode === "points"
        ? `${p.score} pts`
        : Array.from({ length: G.maxLives }, (_, k) => `<span class="life${k < p.lives ? "" : " lost"}"></span>`).join("");
      return `<div class="pchip${i === G.turn ? " active" : ""}${p.out ? " out" : ""}">
        <span class="pn">${esc(p.name)}</span><span class="pv">${val}</span></div>`;
    }).join("");
    const active = $("scoreboard").querySelector(".active");
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderChain() {
    const list = $("chain");
    $("chain-empty").hidden = G.chain.length > 0;
    const L = linkLen();
    let lastIdx = -1;
    G.chain.forEach((c, i) => { if (!c.system && !c.trapped) lastIdx = i; });
    list.innerHTML = G.chain.map((c, i) => {
      if (c.system) return `<li class="system"><span class="w">${esc(c.text)}</span></li>`;
      const prev = G.chain.slice(0, i).reverse().find((x) => !x.system && !x.trapped);
      const head = prev ? c.word.slice(0, L) : "";
      const tail = c.word.slice(-L);
      const mid = c.word.slice(head.length, c.word.length - L);
      const word = c.word.length <= head.length + L
        ? (head ? `<mark>${esc(c.word)}</mark>` : `${esc(c.word.slice(0, -L))}<mark>${esc(tail)}</mark>`)
        : `${head ? `<mark>${esc(head)}</mark>` : ""}${esc(mid)}<mark>${esc(tail)}</mark>`;
      const who = esc(G.players[c.by].name);
      const pts = c.pts ? `<span class="pts">+${c.pts}</span>` : "";
      const unv = !c.verified && !c.trapped ? `<span class="unverified" title="Not checked">?</span>` : "";
      const canChallenge = i === G.chain.length - 1 && !c.verified && !c.trapped;
      const btn = canChallenge ? `<button class="challenge" type="button" data-challenge>Challenge</button>` : "";
      return `<li class="${i === lastIdx ? "latest" : ""}"><span class="w">${c.trapped ? `<s>${esc(c.word)}</s>` : word}</span>
        <span class="meta">${who}${pts}${unv}${btn}</span></li>`;
    }).join("");
    const wrap = list.parentElement;
    wrap.scrollTop = wrap.scrollHeight;
  }

  function renderTurn() {
    const p = G.players[G.turn];
    $("who").textContent = p.cpu ? `${p.name}` : `${p.name}'s turn`;
    const need = needed();
    const needEl = $("need");
    needEl.textContent = need ? need.toUpperCase() : "Any word";
    needEl.classList.toggle("open", !need);
    const bits = [];
    bits.push(`min <b>${minLen()}</b> letters`);
    if (G.trap) bits.push(`don't end on <b>${G.trap.toUpperCase()}</b>`);
    if (G.mode === "sudden") bits.push(`<b>${turnSeconds()}s</b> clock`);
    if (G.mode === "points") {
      const round = Math.min(G.rounds, Math.floor(G.turnCount / G.players.length) + 1);
      bits.push(`round <b>${round}</b>/${G.rounds}`);
    }
    bits.push(`<b>${G.used.size}</b> used`);
    $("rules-line").innerHTML = bits.map((b) => `<span>${b}</span>`).join("");
    const human = !p.cpu;
    $("word-input").disabled = !human;
    $("submit-btn").disabled = !human;
    $("word-input").placeholder = human ? (need ? `Starts with ${need.toUpperCase()}…` : "Any word to start") : "Computer's turn";
    paintClock();
  }

  function addSystem(text) {
    G.chain.push({ system: true, text });
    renderChain();
  }

  function setMsg(text, kind) {
    const m = $("msg");
    m.textContent = text;
    m.className = "msg" + (kind ? ` ${kind}` : "");
  }

  function showScreen(name) {
    ["setup", "play", "over"].forEach((s) => { $(`screen-${s}`).hidden = s !== name; });
    window.scrollTo(0, 0);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- sound ----------
  function unlockAudio() {
    if (audio || !setup.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audio = new Ctx();
    } catch (e) { audio = null; }
  }

  function beep(freq, dur, vol, type) {
    if (!audio || !setup.sound || !G) return;
    try {
      if (audio.state === "suspended") audio.resume();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      const t = audio.currentTime;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  // ---------- wiring ----------
  function bindPlay() {
    $("entry-form").addEventListener("submit", (e) => {
      e.preventDefault();
      submitWord($("word-input").value);
    });
    $("ready-btn").addEventListener("click", () => { unlockAudio(); if (G && G.phase === "handoff") startClock(); });
    $("chain").addEventListener("click", (e) => { if (e.target.closest("[data-challenge]")) challenge(); });
    $("quit-btn").addEventListener("click", () => { $("confirm-quit").hidden = false; });
    $("quit-no").addEventListener("click", () => { $("confirm-quit").hidden = true; });
    $("quit-yes").addEventListener("click", () => { $("confirm-quit").hidden = true; gameOver(true); });
    $("rematch-btn").addEventListener("click", startGame);
    $("setup-btn").addEventListener("click", () => { G = null; showScreen("setup"); });
    // If the page is hidden mid-turn, stop the clock instead of burning the player's time.
    document.addEventListener("visibilitychange", () => {
      if (!G) return;
      if (document.hidden && G.phase === "play") { pauseClock(); clearTimeout(cpuTimer); G.hiddenPause = true; }
      else if (!document.hidden && G.hiddenPause) {
        G.hiddenPause = false;
        resumeClock();
        if (G.players[G.turn].cpu) cpuPlay();
      }
    });
  }

  renderModes();
  renderPlayersEdit();
  syncSetupFields();
  bindSetup();
  bindPlay();
})();
