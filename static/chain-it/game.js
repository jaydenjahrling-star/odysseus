// Chain It — a word chain game.
// Main modes: Normal (start with the previous word's last letter),
// Alphabetical (walk the alphabet one letter per word), Themed (normal
// chaining, every word fits a random theme) and Solo (any of those three,
// alone, for a personal best). Extra modes are variants on Normal.
// Every word must be a real word, and no word can be used twice.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "chain-it:setup:v3";
  const PB_KEY = "chain-it:pb";
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

  // ---------- word data ----------
  const CURATED = window.CHAIN_IT_WORDS || [];
  const D = window.CHAIN_IT_DICT || { common: "", rest: "" };
  const COMMON = D.common ? D.common.split(" ") : [];
  const DICT = new Set(COMMON);
  if (D.rest) for (const w of D.rest.split(" ")) DICT.add(w);
  for (const w of CURATED) DICT.add(w);

  const THEMES = {};
  for (const [id, t] of Object.entries(window.CHAIN_IT_THEMES || {})) {
    const list = t.words.trim().split(/\s+/).map((w) => w.replace(/_/g, " "));
    THEMES[id] = { id, name: t.name, list, set: new Set(list) };
    for (const w of list) if (!w.includes(" ")) DICT.add(w);
  }
  const THEME_IDS = Object.keys(THEMES);

  // Computer vocabulary: the hand-picked list first, then common dictionary words.
  const CPU_EASY = CURATED;
  const CPU_FULL = Array.from(new Set(CURATED.concat(COMMON.filter((w) => w.length <= 9))));

  // Letters that start few English words. Ending on one pressures the next player.
  const END_BONUS = { x: 6, q: 6, z: 5, j: 5, k: 3, y: 3, v: 3, u: 2, i: 1, o: 1, n: 1 };
  const TRAP_POOL = ["e", "s", "t", "y", "d", "r", "n"];
  const TIMEOUT_PENALTY = 3;

  const MAIN_MODES = [
    {
      id: "normal", glyph: "A→A", name: "Normal",
      desc: "Each word starts with the last letter of the word before it.",
      guide: "Player 1 opens with any word. Every next word starts with the last letter of the previous one (tiger → rabbit → tomato). Last player with lives left wins.",
    },
    {
      id: "alpha", glyph: "A→B", name: "Alphabetical",
      desc: "Player 1 gets a random letter. Each next word uses the next letter of the alphabet.",
      guide: "The game picks a random starting letter. Each accepted word moves the letter one step along the alphabet, and after Z it wraps back to A. A miss keeps the same letter for the next player.",
    },
    {
      id: "themed", glyph: "{A}", name: "Themed",
      desc: "A random theme is picked. Normal rules, but every word has to fit it.",
      guide: "A theme such as Animals, Food & Drink or Places is picked at random. Chaining works like Normal, and every word must belong to the theme. With two or more people playing, a real word that isn't on the theme list goes to a quick vote.",
    },
    {
      id: "solo", glyph: "1P", name: "Solo",
      desc: "Play Normal, Alphabetical or Themed on your own and chase your personal best.",
      guide: "Just you against the clock. Your score is how many words you chain before your lives run out, and your best score for each mode is saved on this device.",
    },
  ];

  const EXTRA_MODES = [
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
      guide: "Each word scores its length, plus a bonus for ending on a hard letter (X and Q +6, Z and J +5, K, Y and V +3). A miss costs 3 points. Highest score after the set rounds wins.",
    },
  ];
  const ALL_MODES = MAIN_MODES.concat(EXTRA_MODES);
  const SOLO_MODES = [
    { id: "normal", name: "Normal" },
    { id: "alpha", name: "Alphabetical" },
    { id: "themed", name: "Themed" },
  ];
  const modeName = (id) => (ALL_MODES.find((m) => m.id === id) || {}).name || id;

  // ---------- state ----------
  let setup = loadSetup();
  let G = null;           // current game
  let raf = 0;
  let cpuTimer = 0;
  let audio = null;
  let lastTickSec = -1;

  // ---------- storage ----------
  function defaultSetup() {
    return {
      players: [{ name: "Player 1", cpu: false }, { name: "Player 2", cpu: false }],
      cpuLevel: "normal",
      mode: "normal",
      soloMode: "normal",
      soloName: "",
      time: 8,
      lives: 2,
      strict: true,
      rounds: 5,
      handoff: true,
      sound: true,
    };
  }

  function loadSetup() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = Object.assign(defaultSetup(), JSON.parse(raw));
        if (!ALL_MODES.some((m) => m.id === s.mode)) s.mode = "normal";
        if (Array.isArray(s.players) && s.players.length) return s;
      }
    } catch (e) { /* storage unavailable */ }
    return defaultSetup();
  }

  function saveSetup() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(setup)); } catch (e) { /* ignore */ }
  }

  function loadPB() {
    try { return JSON.parse(localStorage.getItem(PB_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePB(pb) {
    try { localStorage.setItem(PB_KEY, JSON.stringify(pb)); } catch (e) { /* ignore */ }
  }

  // ---------- setup screen ----------
  function modeCard(m) {
    return `
      <label class="mode">
        <input type="radio" name="mode" id="mode-${m.id}" value="${m.id}" ${m.id === setup.mode ? "checked" : ""}>
        <span class="mode-card">
          <span class="glyph">${m.glyph}</span>
          <span class="name">${m.name}</span>
          <span class="desc">${m.desc}</span>
        </span>
      </label>`;
  }

  function renderModes() {
    $("modes-main").innerHTML = MAIN_MODES.map(modeCard).join("");
    $("modes-extra").innerHTML = EXTRA_MODES.map(modeCard).join("");
    $("solo-modes").innerHTML = SOLO_MODES.map((m) => `
      <label class="seg">
        <input type="radio" name="solo-mode" id="solo-${m.id}" value="${m.id}" ${m.id === setup.soloMode ? "checked" : ""}>
        <span>${m.name}</span>
      </label>`).join("");
    $("guide-modes").innerHTML = MAIN_MODES.map((m) => `<dt>${m.name}</dt><dd>${m.guide}</dd>`).join("");
    $("guide-extra").innerHTML = EXTRA_MODES.map((m) => `<dt>${m.name}</dt><dd>${m.guide}</dd>`).join("");
    $("guide-themes").textContent = THEME_IDS.map((id) => THEMES[id].name).join(", ") + ".";
    if (EXTRA_MODES.some((m) => m.id === setup.mode)) $("extra").open = true;
  }

  function renderPB() {
    const pb = loadPB();
    $("pb-list").innerHTML = SOLO_MODES.map((m) =>
      `<li><span>${m.name}</span><b>${pb[m.id] ? pb[m.id] : "–"}</b></li>`).join("");
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
    $("solo-name").value = setup.soloName;
    $("opt-strict").checked = setup.strict;
    $("opt-handoff").checked = setup.handoff;
    $("opt-sound").checked = setup.sound;
    syncModeFields();
  }

  function syncModeFields() {
    const solo = setup.mode === "solo";
    const points = setup.mode === "points";
    $("players-block").hidden = solo;
    $("solo-panel").hidden = !solo;
    $("handoff-opt").hidden = solo;
    $("lives-field").hidden = points;
    $("rounds-field").hidden = !points;
    $("time-label").textContent = setup.mode === "sudden" ? "Starting time" : "Time per turn";
    $("start-btn").textContent = solo ? "Start solo run" : "Start chain";
    if (solo) renderPB();
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
    $("setup-form").addEventListener("change", (e) => {
      if (e.target.name === "mode") { setup.mode = e.target.value; syncModeFields(); saveSetup(); }
      if (e.target.name === "solo-mode") { setup.soloMode = e.target.value; saveSetup(); }
    });
    $("solo-name").addEventListener("input", (e) => { setup.soloName = e.target.value; saveSetup(); });
    const bindSel = (id, key, num) => $(id).addEventListener("change", (e) => {
      setup[key] = num ? Number(e.target.value) : e.target.value; saveSetup();
    });
    bindSel("cpu-level", "cpuLevel");
    bindSel("time-limit", "time", true);
    bindSel("lives", "lives", true);
    bindSel("rounds", "rounds", true);
    const bindChk = (id, key) => $(id).addEventListener("change", (e) => { setup[key] = e.target.checked; saveSetup(); });
    bindChk("opt-strict", "strict");
    bindChk("opt-handoff", "handoff");
    bindChk("opt-sound", "sound");
    $("setup-form").addEventListener("submit", (e) => { e.preventDefault(); startGame(); });
  }

  // ---------- game ----------
  function startGame() {
    unlockAudio();
    const s = setup;
    const solo = s.mode === "solo";
    const mode = solo ? s.soloMode : s.mode;
    const roster = solo
      ? [{ name: (s.soloName || "").trim() || "You", cpu: false }]
      : s.players;
    G = {
      mode,
      solo,
      baseTime: s.time,
      maxLives: mode === "points" ? 0 : s.lives,
      rounds: s.rounds,
      strict: s.strict,
      handoff: s.handoff && !solo,
      cpuLevel: s.cpuLevel,
      players: roster.map((p, i) => ({
        name: (p.name || "").trim() || (p.cpu ? "Computer" : `Player ${i + 1}`),
        cpu: p.cpu,
        lives: s.lives,
        score: 0,
        out: false,
        words: 0,
      })),
      chain: [],            // {word, by, pts, trapped?} or {system:true, text}
      used: new Set(),
      turn: 0,
      turnCount: 0,         // turns taken (accepted or missed)
      accepted: 0,          // accepted words
      trap: mode === "trap" ? pick(TRAP_POOL) : null,
      alphaStart: Math.floor(Math.random() * 26),
      theme: mode === "themed" ? THEMES[pick(THEME_IDS)] : null,
      deadline: 0,
      turnMs: 0,
      pausedLeft: null,
      phase: "idle",        // idle | handoff | play | checking | over
      lastHuman: null,
      pbBefore: solo ? (loadPB()[mode] || 0) : 0,
    };
    G.humans = G.players.filter((p) => !p.cpu).length;
    showScreen("play");
    $("theme-pill").hidden = !G.theme;
    if (G.theme) $("theme-pill").innerHTML = `Theme <b>${esc(G.theme.name)}</b>`;
    $("chain").innerHTML = "";
    renderAll();
    beginTurn(true);
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const words = () => G.chain.filter((c) => !c.system);
  const links = () => words().filter((c) => !c.trapped);
  const lastWord = () => { const w = links(); return w.length ? w[w.length - 1] : null; };
  const linkLen = () => (G.mode === "long" ? 2 : 1);
  const letters = (w) => w.replace(/ /g, "");

  // The letter(s) the current word must start with, or "" for a free opening word.
  function needed() {
    if (G.mode === "alpha") return ALPHABET[(G.alphaStart + G.accepted) % 26];
    const lw = lastWord();
    return lw ? letters(lw.word).slice(-linkLen()) : "";
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
    const needHandoff = G.handoff && !p.cpu && G.humans > 1 && G.lastHuman !== G.turn && !(first && G.turn === 0);
    if (needHandoff) {
      // The letter stays hidden until the player starts their turn.
      G.phase = "handoff";
      renderTurn();
      $("handoff-name").textContent = p.name;
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

  // Normalize typed input: lowercase, curly quotes and hyphens become spaces
  // (only Themed allows multi-word answers such as "new york").
  function normalize(raw) {
    return raw.toLowerCase().replace(/[-‐–—]/g, " ").replace(/\s+/g, " ").trim();
  }

  // A word counts as a repeat if it, or its simple singular/plural form, was already played.
  function repeatOf(w) {
    const forms = [w, w + "s", w + "es"];
    if (w.endsWith("ies")) forms.push(w.slice(0, -3) + "y");
    if (w.endsWith("y")) forms.push(w.slice(0, -1) + "ies");
    if (w.endsWith("es")) forms.push(w.slice(0, -2));
    if (w.endsWith("s")) forms.push(w.slice(0, -1));
    return forms.find((f) => G.used.has(f)) || "";
  }

  // Theme membership, accepting simple plurals of listed words.
  function inTheme(w) {
    const s = G.theme.set;
    if (s.has(w)) return true;
    if (w.endsWith("ies") && s.has(w.slice(0, -3) + "y")) return true;
    if (w.endsWith("es") && s.has(w.slice(0, -2))) return true;
    return w.endsWith("s") && s.has(w.slice(0, -1));
  }

  const isReal = (w) => DICT.has(w);

  // Rule checks. Returns an error string, "" when fine, or "vote" when the
  // word is real but not on the theme list and the table can vote on it.
  function checkWord(w) {
    const themed = !!G.theme;
    if (!(themed ? /^[a-z]+( [a-z]+)*$/ : /^[a-z]+$/).test(w)) return "Letters only, no spaces or symbols.";
    const need = needed();
    const flat = letters(w);
    if (need && !flat.startsWith(need)) return `It has to start with “${need.toUpperCase()}”.`;
    if (flat.length < minLen()) return `Words need at least ${minLen()} letters right now.`;
    const rep = repeatOf(w);
    if (rep) return rep === w ? `“${w}” was already used.` : `“${w}” repeats “${rep}”.`;
    if (themed) {
      if (inTheme(w)) return "";
      if (!isReal(w)) return `“${w}” isn't a real word.`;
      if (G.humans > 1 && !G.solo) return "vote";
      return `“${w}” isn't on the ${G.theme.name} list.`;
    }
    if (!isReal(w)) return `“${w}” isn't a real word.`;
    return "";
  }

  function submitWord(raw) {
    if (!G || G.phase !== "play") return;
    const p = G.players[G.turn];
    if (p.cpu) return;
    const w = normalize(raw);
    if (!w) return;
    const res = checkWord(w);
    if (res === "vote") { askVote(w); return; }
    if (res) { mistake(res); return; }
    accept(w);
  }

  // A real word that isn't on the theme list: the other players decide.
  function askVote(w) {
    pauseClock();
    $("vote-q").innerHTML = `Does <b>${esc(w)}</b> fit <b>${esc(G.theme.name)}</b>?`;
    $("vote").hidden = false;
    G.voteWord = w;
  }

  function settleVote(yes) {
    if (!G || G.phase !== "checking" || !G.voteWord) return;
    const w = G.voteWord;
    G.voteWord = null;
    $("vote").hidden = true;
    resumeClock();
    if (yes) accept(w);
    else mistake(`The table voted “${w}” off-theme.`);
  }

  // Strict rules: any mistake ends the turn and costs a life (or points).
  function mistake(text) {
    if (!G.strict) { reject(text); return; }
    stopClock();
    clearTimeout(cpuTimer);
    const p = G.players[G.turn];
    beep(160, 0.35, 0.12, "sawtooth");
    penalize(p, `slipped (${text.replace(/\.$/, "").replace(/^[A-Z]/, (c) => c.toLowerCase())})`);
    $("word-input").value = "";
    endTurn();
    setMsg(text, "bad");
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

  function accept(w) {
    stopClock();
    const p = G.players[G.turn];
    const player = G.turn;
    if (G.trap && w.endsWith(G.trap)) {
      G.used.add(w);
      G.chain.push({ word: w, by: player, pts: 0, trapped: true });
      beep(160, 0.35, 0.12, "sawtooth");
      penalize(p, `ended on the banned letter ${G.trap.toUpperCase()}`);
      // The trapped word doesn't count as a link; the next player keeps the old letter.
      renderChain();
      $("word-input").value = "";
      endTurn();
      return;
    }
    const flat = letters(w);
    const pts = G.mode === "points" ? flat.length + (END_BONUS[flat.slice(-1)] || 0) : 0;
    p.score += pts;
    p.words += 1;
    G.used.add(w);
    G.chain.push({ word: w, by: player, pts });
    G.accepted += 1;
    G.turnCount += 1;
    beep(660, 0.08, 0.06);
    setTimeout(() => beep(990, 0.1, 0.05), 70);
    $("word-input").value = "";
    endTurn();
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
      if (w) { setMsg(""); accept(w); }
    }, Math.max(0, Math.min(delay, timeLeft() - 400)));
  }

  function cpuPick(level) {
    const need = needed();
    const min = minLen();
    const fits = (w) => letters(w).startsWith(need) && letters(w).length >= min &&
      !repeatOf(w) && !(G.trap && w.endsWith(G.trap));
    let pool;
    if (G.theme) pool = G.theme.list;
    else if (level === "hard") pool = CPU_FULL;
    else {
      pool = CPU_EASY;
      if (!pool.some(fits)) pool = CPU_FULL;
    }
    const ok = pool.filter(fits);
    if (!ok.length) return null;
    // Alphabetical has a fixed next letter, so there is nothing to plan.
    if (level !== "hard" || G.mode === "alpha") return pick(ok);
    // Hard: pick the word that leaves the next player the fewest options.
    const L = linkLen();
    const counts = new Map();
    for (const x of pool) {
      if (repeatOf(x)) continue;
      const k = letters(x).slice(0, L);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = null, bestN = Infinity;
    for (const w of ok) {
      const n = (counts.get(letters(w).slice(-L)) || 0) + Math.random() * 0.5;
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
    $("vote").hidden = true;
    $("confirm-quit").hidden = true;
    const ws = links();
    let ranked;
    let eyebrow = "Chain broken";
    if (G.solo) {
      ranked = G.players.slice();
      const n = ws.length;
      $("winner").textContent = `${n} ${n === 1 ? "word" : "words"}`;
      const pb = loadPB();
      if (n > (pb[G.mode] || 0)) {
        pb[G.mode] = n;
        savePB(pb);
        eyebrow = G.pbBefore ? `New personal best! Old best: ${G.pbBefore}` : "First personal best set";
      } else {
        eyebrow = `Personal best: ${pb[G.mode]}`;
      }
    } else if (G.mode === "points") {
      ranked = G.players.slice().sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const tie = ranked.length > 1 && ranked[1].score === top.score;
      $("winner").textContent = tie ? "It's a tie" : `${top.name} wins`;
    } else {
      // Survivors first, then by lives left and words played.
      ranked = G.players.slice().sort((a, b) => (a.out - b.out) || (b.lives - a.lives) || (b.words - a.words));
      const left = alive();
      if (left.length === 1) $("winner").textContent = `${left[0].name} wins`;
      else if (!left.length) $("winner").textContent = "Nobody survived";
      else $("winner").textContent = quit ? "Game ended early" : `${ranked[0].name} wins`;
    }
    $("over-eyebrow").textContent = eyebrow;
    const longest = ws.reduce((a, c) => (letters(c.word).length > (a ? letters(a.word).length : 0) ? c : a), null);
    let modeLabel = (G.solo ? "Solo · " : "") + modeName(G.mode);
    if (G.trap) modeLabel += ` · no “${G.trap.toUpperCase()}”`;
    if (G.theme) modeLabel += ` · ${G.theme.name}`;
    $("stats").innerHTML = [
      stat("Chain length", `${ws.length} ${ws.length === 1 ? "word" : "words"}`),
      stat("Longest word", longest ? `${longest.word} (${letters(longest.word).length})` : "none"),
      stat("Mode", modeLabel),
    ].join("");
    $("standings").hidden = G.solo;
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
    }).join("") + (G.solo ? `<div class="pchip best"><span class="pn">Best</span><span class="pv">${Math.max(G.pbBefore, links().length)}</span></div>` : "");
    const active = $("scoreboard").querySelector(".active");
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderChain() {
    const list = $("chain");
    $("chain-empty").hidden = G.chain.length > 0;
    $("chain-empty").textContent = G.mode === "alpha"
      ? "The chain is empty. The first word uses a random letter."
      : G.theme ? `The chain is empty. Open with anything from ${G.theme.name}.`
      : "The chain is empty. Open with any word.";
    const L = linkLen();
    const alpha = G.mode === "alpha";
    let lastIdx = -1;
    G.chain.forEach((c, i) => { if (!c.system && !c.trapped) lastIdx = i; });
    list.innerHTML = G.chain.map((c, i) => {
      if (c.system) return `<li class="system"><span class="w">${esc(c.text)}</span></li>`;
      const who = esc(G.players[c.by].name);
      const pts = c.pts ? `<span class="pts">+${c.pts}</span>` : "";
      let word;
      if (c.trapped) word = `<s>${esc(c.word)}</s>`;
      else if (alpha) word = `<mark>${esc(c.word[0])}</mark>${esc(c.word.slice(1))}`;
      else {
        const prev = G.chain.slice(0, i).reverse().find((x) => !x.system && !x.trapped);
        word = markLinks(c.word, prev ? L : 0, L);
      }
      return `<li class="${i === lastIdx ? "latest" : ""}"><span class="w">${word}</span>
        <span class="meta">${who}${pts}</span></li>`;
    }).join("");
    const wrap = list.parentElement;
    wrap.scrollTop = wrap.scrollHeight;
  }

  // Highlight the first `head` and last `tail` letters of a word (spaces don't count).
  function markLinks(word, head, tail) {
    const n = letters(word).length;
    let seen = 0;
    let out = "";
    let open = false;
    for (const ch of word) {
      const isLetter = ch !== " ";
      const idx = seen;
      if (isLetter) seen++;
      const hot = isLetter && (idx < head || idx >= n - tail);
      if (hot && !open) { out += "<mark>"; open = true; }
      if (!hot && open) { out += "</mark>"; open = false; }
      out += esc(ch);
    }
    return out + (open ? "</mark>" : "");
  }

  function renderTurn() {
    const p = G.players[G.turn];
    $("who").textContent = p.cpu ? `${p.name}` : G.solo ? "Your turn" : `${p.name}'s turn`;
    const hide = G.phase === "handoff";
    const need = hide ? "" : needed();
    const needEl = $("need");
    needEl.textContent = hide ? "?" : need ? need.toUpperCase() : "Any word";
    needEl.classList.toggle("open", !need && !hide);
    const bits = [];
    bits.push(`min <b>${minLen()}</b> letters`);
    if (G.trap) bits.push(`don't end on <b>${G.trap.toUpperCase()}</b>`);
    if (G.mode === "sudden") bits.push(`<b>${turnSeconds()}s</b> clock`);
    if (G.mode === "points") {
      const round = Math.min(G.rounds, Math.floor(G.turnCount / G.players.length) + 1);
      bits.push(`round <b>${round}</b>/${G.rounds}`);
    }
    bits.push(`<b>${links().length}</b> chained`);
    $("rules-line").innerHTML = bits.map((b) => `<span>${b}</span>`).join("");
    const human = !p.cpu;
    $("word-input").disabled = !human;
    $("submit-btn").disabled = !human;
    $("word-input").placeholder = hide ? "" : human ? (need ? `Starts with ${need.toUpperCase()}…` : "Any word to start") : "Computer's turn";
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
    $("vote-yes").addEventListener("click", () => settleVote(true));
    $("vote-no").addEventListener("click", () => settleVote(false));
    const askQuit = () => { $("confirm-quit").hidden = false; };
    $("quit-btn").addEventListener("click", askQuit);
    $("handoff-quit").addEventListener("click", askQuit);
    $("quit-no").addEventListener("click", () => { $("confirm-quit").hidden = true; });
    $("quit-yes").addEventListener("click", () => { $("confirm-quit").hidden = true; gameOver(true); });
    $("rematch-btn").addEventListener("click", startGame);
    $("setup-btn").addEventListener("click", () => { G = null; showScreen("setup"); syncModeFields(); });
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
