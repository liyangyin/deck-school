import { build } from './ui.js';
import * as tutor from './tutor.js';
import * as E from './engine.js';

const frame = build();
tutor.mount();
(function loop() {
  frame();
  requestAnimationFrame(loop);
})();
// lesson checks run on a timer so they keep working if the browser throttles animation frames
setInterval(() => tutor.tick(), 60);

// handy in the console while developing lessons
window.deck = { E, tutor };
