# Deck School

A browser DJ simulator laid out like VirtualDJ's two-deck Essentials skin (light theme), with a
15-lesson course. Buttons you need to press light up, and knobs and faders show a marker where
to move them; each step checks that you did it.

## Run

    npm start

Then open http://127.0.0.1:4173 (set `PORT=xxxx` for another port). No dependencies, no build step:
plain HTML, CSS and ES modules. Any static host works, as long as it is served over http(s)
(the audio worklet does not load from `file://`).

## What is simulated

- Two decks: play/pause, CDJ-style CUE, SYNC, pitch fader (±8/12/20%), pitch bend, jog wheel
  (centre = scratch, outer ring = nudge), auto and manual loops, one FX slot (echo, reverb,
  flanger; post-fader so echo tails ring out).
- Key lock: tempo changes without changing pitch (WSOLA time-stretch in the deck worklet).
- Four pad pages: hot cues, loop roll and slicer (both slip: the track keeps running underneath),
  and an 8-sound sampler.
- Mixer: gain, 3-band EQ with kill, filter, channel faders, crossfader, level meters, master.
- Headphone cue: PFL buttons, headphone volume and cue/master MIX knob. The OUTPUT menu picks the
  routing: speakers only, headphones only (you hear the headphone bus), split cable (left = master,
  right = headphones), or a 4-channel sound card (master 1-2, headphones 3-4).
- Scrolling rhythm waves with beat/bar/phrase grid, song overviews, browser with drag and drop.

Not simulated: video and scratch mixer tabs, sending headphones to a second audio device.

## Music

Thirteen tracks are synthesized in the browser (`js/synth.js`), so beat grids are exact and nothing
is downloaded: seven plain practice tracks used by the lessons, and six "hype crate" tracks in tech
house, melodic house and piano rave styles (set by `style` in `js/tracks.js`). "Add your own files" imports local audio; its BPM and grid are estimated.

## Layout

    index.html, style.css
    js/main.js            boot + frame loop
    js/engine.js          audio graph, deck state, transport, loops, sync
    js/deck-processor.js  AudioWorklet deck player
    js/synth.js           track synthesizer, waveform analysis, BPM detection (runs in synth-worker.js)
    js/tracks.js          practice crate and song structure
    js/ui.js, js/wave.js  interface and canvas drawing
    js/lessons.js         the course (steps, targets, checks)
    js/tutor.js           lesson runner, highlights, progress (localStorage)

## Adding a lesson

Append an object to `LESSONS` in `js/lessons.js`. A step's `target` lists `data-t` names of the
controls to light up (for example `eq-low-0`, `fader-1`, `cross`), `goal` maps a knob or fader to
the value it should be moved to, and `check(c)` returns true once the learner has done it. `hold`
is how long the check must stay true, in milliseconds. See the comment at the top of the file.

## Deploying to liyangyin.com/dj

The live copy is part of the portfolio site (`~/Desktop/Code/1. Portfolio Website`, a Cloudflare
Worker with static assets). Copy the public files into its `v2/dj/` folder and publish from there:

    rsync -a --delete index.html style.css favicon.svg js "$HOME/Desktop/Code/1. Portfolio Website/v2/dj/"
    cd "$HOME/Desktop/Code/1. Portfolio Website" && ./deploy.sh

`./deploy.sh` publishes the whole site, including any other unpublished changes in `v2/`.
