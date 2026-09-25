# Wine-Dark Sudoku

A single-file Sudoku built to make long stretches of time disappear. Open `index.html` in any browser. It has no dependencies or build step, works offline once the fonts are cached, and saves your progress in the browser.

## How it makes eight hours feel like twenty minutes

Each feature comes from research on flow and on how we perceive time:

| Principle | What the game does |
| --- | --- |
| **Watching the clock makes time drag** (studies on time perception during boredom vs. absorption) | No timer or clock anywhere. The only sign of time is the sky over your voyage, which moves from dawn to night as you **solve islands**, not as minutes pass. |
| **Flow needs challenge just above skill** (Csikszentmihalyi) | Adaptive difficulty ("sea state", 1–10). Clean, fast solves remove givens (46 down to 24). Slips and hints add them back. Solve time is tracked internally for this but never shown. |
| **Clear goals and immediate feedback** | Correct digits pop, finished rows/columns/boxes ripple, a run counter climbs, and optional pentatonic tones rise with your run. |
| **Remove stopping cues** (autoplay / "next episode" effect) | The next puzzle is generated while you read the summary and starts on its own after 6 seconds. |
| **Cut friction** | Notes clear themselves when you place a digit, matching digits and notes are highlighted, finished numbers fade from the pad, and hints reveal the most constrained cell. |
| **Visible progress and open loops** (goal-gradient, Zeigarnik) | Islands from the Odyssey form legs of 6 on the way to Ithaca. The ship moves along the horizon. |
| **Sustainable focus** | After every leg you get a 20-second eye break (20-20-20 rule), so the session stays comfortable over hours. The screen stays awake while you play (Wake Lock). |

## Controls

- Tap a cell, then a digit. Toggle **Notes** for pencil marks.
- Keyboard: `1`–`9`, arrows, `Backspace`/`0` erase, `N` notes, `Z` undo, `H` hint, `Enter` to sail on.
- The ⓘ button explains the design and lets you set the sea calmer or rougher by hand.

## On iPhone

Open the page in Safari, tap Share → **Add to Home Screen**. It then launches full-screen like an app.
