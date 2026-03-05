// ============================================================
// EPILEPSY AWARENESS MAZE GAME (p5.js)
// ============================================================

// ============================================================
// CONSTANTS
// ============================================================
const CELL_SIZE = 48;
const MAZE_COLS = 25;
const MAZE_ROWS = 25;
const MAZE_WIDTH = MAZE_COLS * CELL_SIZE;
const MAZE_HEIGHT = MAZE_ROWS * CELL_SIZE;
const PLAYER_SIZE = 20;
const PLAYER_SPEED = 2.5;
const RUN_SPEED = 4.5;
const GAME_TIME = 90;
const EPISODE_DURATION_MIN = 4;
const EPISODE_DURATION_MAX = 5;
const BASE_VISIBILITY_RADIUS = 260;
const MIN_VISIBILITY_RADIUS = 100;
const STRESS_PASSIVE_RATE = 0.03;
const STRESS_RUN_RATE = 0.12;
const STRESS_NARROW_RATE = 0.08;
const STRESS_SCARY_RATE = 0.1;
const STRESS_CALM_DRAIN = -0.25;
const STRESS_STILL_DRAIN = -0.05;
const MICRO_SPIKE_CHANCE = 0.003;
const MICRO_SPIKE_AMOUNT = 8;

// ============================================================
// GAME STATE
// ============================================================
let gameState = 'menu';
let selectedChar = 0;
const characters = [
  { name: 'Alex', color: '#4fc3f7', accent: '#0288d1' },
  { name: 'Sam', color: '#ef5350', accent: '#c62828' },
  { name: 'Jordan', color: '#66bb6a', accent: '#2e7d32' },
];

let player = { x: 0, y: 0 };
let stress = 0;
let timer = GAME_TIME;
let maze = [];
let calmZones = [];
let scaryZones = [];
let narrowZones = [];
let endPos = { x: 0, y: 0 };
let episodeTimer = 0;
let episodeDuration = 0;
let controlsInverted = false;
let screenShake = { x: 0, y: 0 };
let microSpikeActive = 0;
let lastTime = 0;
let dt = 0;

// p5.js fog buffer
let fogBuffer;

// ============================================================
// AUDIO (procedural - Web Audio API, not p5 sound)
// ============================================================
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, type = 'sine', vol = 0.15) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) { /* ignore audio errors */ }
}

function playEpisodeSound() {
  playTone(80, 1.5, 'sawtooth', 0.1);
  playTone(120, 1.5, 'square', 0.05);
}

function playMicroSpikeSound() {
  playTone(300, 0.15, 'square', 0.08);
}

function playWinSound() {
  playTone(523, 0.2, 'sine', 0.2);
  setTimeout(() => playTone(659, 0.2, 'sine', 0.2), 150);
  setTimeout(() => playTone(784, 0.4, 'sine', 0.2), 300);
}

function playLoseSound() {
  playTone(200, 0.5, 'sawtooth', 0.15);
  setTimeout(() => playTone(150, 0.8, 'sawtooth', 0.1), 400);
}

function playStepSound() {
  if (frameCount % 15 === 0) {
    playTone(100 + random(50), 0.05, 'triangle', 0.03);
  }
}

// ============================================================
// MAZE GENERATION (Recursive Backtracker)
// ============================================================
function generateMaze() {
  maze = [];
  for (let r = 0; r < MAZE_ROWS; r++) {
    maze[r] = [];
    for (let c = 0; c < MAZE_COLS; c++) {
      maze[r][c] = { top: true, right: true, bottom: true, left: true, visited: false };
    }
  }

  const stack = [];
  let current = { r: 0, c: 0 };
  maze[0][0].visited = true;
  stack.push(current);

  while (stack.length > 0) {
    const { r, c } = current;
    const neighbors = [];
    if (r > 0 && !maze[r - 1][c].visited) neighbors.push({ r: r - 1, c, dir: 'top' });
    if (c < MAZE_COLS - 1 && !maze[r][c + 1].visited) neighbors.push({ r, c: c + 1, dir: 'right' });
    if (r < MAZE_ROWS - 1 && !maze[r + 1][c].visited) neighbors.push({ r: r + 1, c, dir: 'bottom' });
    if (c > 0 && !maze[r][c - 1].visited) neighbors.push({ r, c: c - 1, dir: 'left' });

    if (neighbors.length > 0) {
      const next = neighbors[Math.floor(Math.random() * neighbors.length)];
      if (next.dir === 'top') { maze[r][c].top = false; maze[next.r][next.c].bottom = false; }
      if (next.dir === 'right') { maze[r][c].right = false; maze[next.r][next.c].left = false; }
      if (next.dir === 'bottom') { maze[r][c].bottom = false; maze[next.r][next.c].top = false; }
      if (next.dir === 'left') { maze[r][c].left = false; maze[next.r][next.c].right = false; }
      maze[next.r][next.c].visited = true;
      stack.push(current);
      current = next;
    } else {
      current = stack.pop();
    }
  }

  player.x = CELL_SIZE / 2;
  player.y = CELL_SIZE / 2;
  endPos.x = (MAZE_COLS - 1) * CELL_SIZE + CELL_SIZE / 2;
  endPos.y = (MAZE_ROWS - 1) * CELL_SIZE + CELL_SIZE / 2;

  // Calm zones (5-7)
  calmZones = [];
  const calmCount = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < calmCount; i++) {
    let cr, cc;
    do {
      cr = Math.floor(Math.random() * MAZE_ROWS);
      cc = Math.floor(Math.random() * MAZE_COLS);
    } while ((cr === 0 && cc === 0) || (cr === MAZE_ROWS - 1 && cc === MAZE_COLS - 1));
    calmZones.push({ r: cr, c: cc });
  }

  // Scary zones (6-10)
  scaryZones = [];
  const scaryCount = 6 + Math.floor(Math.random() * 5);
  for (let i = 0; i < scaryCount; i++) {
    let sr, sc;
    do {
      sr = Math.floor(Math.random() * MAZE_ROWS);
      sc = Math.floor(Math.random() * MAZE_COLS);
    } while (
      (sr === 0 && sc === 0) ||
      calmZones.some(cz => cz.r === sr && cz.c === sc)
    );
    scaryZones.push({ r: sr, c: sc });
  }

  // Narrow zones (dead ends)
  narrowZones = [];
  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      const cell = maze[r][c];
      const wallCount = (cell.top ? 1 : 0) + (cell.right ? 1 : 0) + (cell.bottom ? 1 : 0) + (cell.left ? 1 : 0);
      if (wallCount >= 3) {
        narrowZones.push({ r, c });
      }
    }
  }
}

// ============================================================
// COLLISION DETECTION
// ============================================================
function getPlayerCell() {
  return {
    r: Math.floor(player.y / CELL_SIZE),
    c: Math.floor(player.x / CELL_SIZE)
  };
}

function canMove(nx, ny) {
  const halfSize = PLAYER_SIZE / 2;
  const corners = [
    { x: nx - halfSize, y: ny - halfSize },
    { x: nx + halfSize, y: ny - halfSize },
    { x: nx - halfSize, y: ny + halfSize },
    { x: nx + halfSize, y: ny + halfSize },
  ];

  for (const corner of corners) {
    if (corner.x < 0 || corner.y < 0 || corner.x >= MAZE_WIDTH || corner.y >= MAZE_HEIGHT) {
      return false;
    }
  }

  const margin = 2;
  const cellR = Math.floor(ny / CELL_SIZE);
  const cellC = Math.floor(nx / CELL_SIZE);
  if (cellR < 0 || cellR >= MAZE_ROWS || cellC < 0 || cellC >= MAZE_COLS) return false;

  const cell = maze[cellR][cellC];
  const cellX = cellC * CELL_SIZE;
  const cellY = cellR * CELL_SIZE;

  if (cell.top && ny - halfSize < cellY + margin) return false;
  if (cell.bottom && ny + halfSize > cellY + CELL_SIZE - margin) return false;
  if (cell.left && nx - halfSize < cellX + margin) return false;
  if (cell.right && nx + halfSize > cellX + CELL_SIZE - margin) return false;

  return true;
}

// ============================================================
// p5.js SETUP
// ============================================================
function setup() {
  createCanvas(windowWidth, windowHeight);
  fogBuffer = createGraphics(windowWidth, windowHeight);
  textFont('Courier New');
  lastTime = millis();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  fogBuffer.resizeCanvas(windowWidth, windowHeight);
}

// ============================================================
// p5.js INPUT
// ============================================================
function keyPressed() {
  if (key === 'Enter') {
    if (gameState === 'menu') {
      gameState = 'charSelect';
    } else if (gameState === 'charSelect') {
      startGame();
    } else if (gameState === 'win' || gameState === 'lose') {
      gameState = 'menu';
    }
  }

  if (key === 'p' || key === 'P') {
    if (gameState === 'playing' || gameState === 'episode') {
      gameState = 'paused';
    } else if (gameState === 'paused') {
      gameState = 'playing';
    }
  }

  if (key === 'r' || key === 'R') {
    if (gameState === 'playing' || gameState === 'paused' || gameState === 'episode' || gameState === 'win' || gameState === 'lose') {
      startGame();
    }
  }

  if (gameState === 'charSelect') {
    if (keyCode === LEFT_ARROW || key === 'a' || key === 'A') {
      selectedChar = (selectedChar - 1 + characters.length) % characters.length;
    }
    if (keyCode === RIGHT_ARROW || key === 'd' || key === 'D') {
      selectedChar = (selectedChar + 1) % characters.length;
    }
  }

  // Prevent default browser behavior for game keys
  return false;
}

// ============================================================
// GAME START
// ============================================================
function startGame() {
  generateMaze();
  stress = 0;
  timer = GAME_TIME;
  episodeTimer = 0;
  controlsInverted = false;
  microSpikeActive = 0;
  screenShake = { x: 0, y: 0 };
  gameState = 'playing';
  lastTime = millis();
}

// ============================================================
// UPDATE
// ============================================================
function updateGame() {
  const now = millis();
  dt = (now - lastTime) / 1000;
  if (dt > 0.1) dt = 0.1;
  lastTime = now;

  if (gameState === 'playing' || gameState === 'episode') {
    updatePlaying();
  }
}

function updatePlaying() {
  // Timer
  timer -= dt;
  if (timer <= 0) {
    timer = 0;
    gameState = 'lose';
    playLoseSound();
    return;
  }

  // Movement
  let dx = 0, dy = 0;
  let up = keyIsDown(UP_ARROW) || keyIsDown(87); // W
  let down = keyIsDown(DOWN_ARROW) || keyIsDown(83); // S
  let left = keyIsDown(LEFT_ARROW) || keyIsDown(65); // A
  let right = keyIsDown(RIGHT_ARROW) || keyIsDown(68); // D

  if (controlsInverted) {
    [up, down] = [down, up];
    [left, right] = [right, left];
  }

  if (up) dy -= 1;
  if (down) dy += 1;
  if (left) dx -= 1;
  if (right) dx += 1;

  if (dx !== 0 && dy !== 0) {
    dx *= 0.707;
    dy *= 0.707;
  }

  const isRunning = keyIsDown(SHIFT);
  let spd = isRunning ? RUN_SPEED : PLAYER_SPEED;
  const isMoving = dx !== 0 || dy !== 0;

  if (gameState === 'episode') {
    spd *= 0.5;
    if (frameCount % 4 < 2) {
      dx = 0;
      dy = 0;
    }
  }

  let nx = player.x + dx * spd;
  let ny = player.y + dy * spd;

  if (canMove(nx, player.y)) player.x = nx;
  if (canMove(player.x, ny)) player.y = ny;

  if (isMoving) playStepSound();

  // Zone detection
  const { r, c } = getPlayerCell();
  const inCalmZone = calmZones.some(cz => cz.r === r && cz.c === c);
  const inScaryZone = scaryZones.some(sz => sz.r === r && sz.c === c);
  const inNarrowZone = narrowZones.some(nz => nz.r === r && nz.c === c);

  // Stress
  if (gameState !== 'episode') {
    stress += STRESS_PASSIVE_RATE * dt * 60;
    if (isMoving && isRunning) stress += STRESS_RUN_RATE * dt * 60;
    if (inNarrowZone) stress += STRESS_NARROW_RATE * dt * 60;
    if (inScaryZone) stress += STRESS_SCARY_RATE * dt * 60;
    if (inCalmZone) stress += STRESS_CALM_DRAIN * dt * 60;
    if (!isMoving) stress += STRESS_STILL_DRAIN * dt * 60;

    if (Math.random() < MICRO_SPIKE_CHANCE) {
      stress += MICRO_SPIKE_AMOUNT;
      microSpikeActive = 15;
      playMicroSpikeSound();
    }

    stress = constrain(stress, 0, 100);

    if (stress >= 100) {
      gameState = 'episode';
      controlsInverted = true;
      episodeDuration = EPISODE_DURATION_MIN + Math.random() * (EPISODE_DURATION_MAX - EPISODE_DURATION_MIN);
      episodeTimer = episodeDuration;
      playEpisodeSound();
    }
  } else {
    episodeTimer -= dt;
    screenShake.x = (Math.random() - 0.5) * 12;
    screenShake.y = (Math.random() - 0.5) * 12;

    const playerStopped = !isMoving;
    if (episodeTimer <= 0 || (playerStopped && episodeTimer < episodeDuration - 1) || inCalmZone) {
      gameState = 'playing';
      controlsInverted = false;
      stress = 60;
      screenShake = { x: 0, y: 0 };
    }
  }

  if (microSpikeActive > 0) microSpikeActive--;

  // Win condition
  const distToEnd = dist(player.x, player.y, endPos.x, endPos.y);
  if (distToEnd < CELL_SIZE / 2) {
    gameState = 'win';
    playWinSound();
  }
}

// ============================================================
// p5.js DRAW (main loop)
// ============================================================
function draw() {
  updateGame();

  if (gameState === 'menu') {
    drawMenu();
  } else if (gameState === 'charSelect') {
    drawCharSelect();
  } else if (gameState === 'playing' || gameState === 'episode') {
    drawGameplay();
  } else if (gameState === 'paused') {
    drawGameplay();
    drawPauseOverlay();
  } else if (gameState === 'win') {
    drawWinScreen();
  } else if (gameState === 'lose') {
    drawLoseScreen();
  }
}

// ============================================================
// MENU SCREEN
// ============================================================
function drawMenu() {
  background(10);

  // Animated background particles
  noStroke();
  for (let i = 0; i < 30; i++) {
    const px = (sin(frameCount * 0.01 + i * 1.5) * 0.5 + 0.5) * width;
    const py = (cos(frameCount * 0.008 + i * 2.1) * 0.5 + 0.5) * height;
    const a = (0.05 + sin(frameCount * 0.02 + i) * 0.03) * 255;
    fill(100, 100, 120, a);
    circle(px, py, 4 + sin(frameCount * 0.03 + i) * 2);
  }

  const cx = width / 2;
  const cy = height / 2;

  // Title
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(52);
  fill(224);
  text('LOST CONTROL', cx, cy - 100);

  // Subtitle
  textStyle(NORMAL);
  textSize(18);
  fill(136);
  text('An Epilepsy Awareness Experience', cx, cy - 60);

  // Flicker
  if (Math.random() < 0.05) {
    fill(255);
    text('An Epilepsy Awareness Experience', cx, cy - 60);
  }

  // Instructions
  textSize(16);
  fill(170);
  text("You are on a journey but terrified of what's to come.", cx, cy + 10);
  text('Navigate the maze before time runs out.', cx, cy + 35);
  text('But beware... you might lose control.', cx, cy + 60);

  // Prompt
  const blink = sin(frameCount * 0.08) > 0;
  if (blink) {
    textStyle(BOLD);
    textSize(22);
    fill(255);
    text('[ PRESS ENTER TO START ]', cx, cy + 130);
  }

  // Controls hint
  textStyle(NORMAL);
  textSize(13);
  fill(85);
  text('WASD / Arrow Keys = Move  |  Shift = Run  |  P = Pause  |  R = Restart', cx, height - 30);
}

// ============================================================
// CHARACTER SELECT SCREEN
// ============================================================
function drawCharSelect() {
  background(10);

  const cx = width / 2;
  const cy = height / 2;

  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(36);
  fill(224);
  text('CHOOSE YOUR CHARACTER', cx, cy - 120);

  textStyle(NORMAL);
  textSize(14);
  fill(136);
  text('Use LEFT / RIGHT arrow keys to select, ENTER to confirm', cx, cy - 80);

  const spacing = 160;
  const startX = cx - spacing;
  for (let i = 0; i < characters.length; i++) {
    const x = startX + i * spacing;
    const y = cy + 10;
    const ch = characters[i];
    const selected = i === selectedChar;

    // Selection highlight
    if (selected) {
      noFill();
      stroke(255);
      strokeWeight(3);
      rect(x - 45, y - 55, 90, 110);

      // Arrow indicators
      noStroke();
      fill(255);
      textStyle(BOLD);
      textSize(24);
      text('>', x + 55, y + 5);
      text('<', x - 55, y + 5);
    }

    // Character body
    noStroke();
    fill(ch.color);
    circle(x, y - 15, 44);

    // Eyes
    fill(255);
    circle(x - 7, y - 20, 10);
    circle(x + 7, y - 20, 10);
    fill(17);
    circle(x - 6, y - 19, 5);
    circle(x + 8, y - 19, 5);

    // Name
    textStyle(selected ? BOLD : NORMAL);
    textSize(16);
    fill(selected ? 255 : 136);
    text(ch.name, x, y + 45);
  }
}

// ============================================================
// GAMEPLAY DRAWING
// ============================================================
function drawGameplay() {
  background(0);

  push();

  // Camera offset (center player on screen)
  let camX = player.x - width / 2;
  let camY = player.y - height / 2;

  // Screen shake
  if (gameState === 'episode') {
    camX += screenShake.x;
    camY += screenShake.y;
  }

  // Micro spike jitter
  if (microSpikeActive > 0) {
    camX += (Math.random() - 0.5) * 6;
    camY += (Math.random() - 0.5) * 6;
  }

  translate(-camX, -camY);

  // --- Maze background ---
  const darken = stress / 100;
  const baseBg = Math.floor(70 - darken * 30);
  noStroke();
  fill(baseBg, baseBg, baseBg + 8);
  rect(0, 0, MAZE_WIDTH, MAZE_HEIGHT);

  // --- Calm zones ---
  for (const cz of calmZones) {
    const zx = cz.c * CELL_SIZE;
    const zy = cz.r * CELL_SIZE;

    // Warm glow (concentric circles for gradient effect)
    noStroke();
    for (let rad = CELL_SIZE; rad > 0; rad -= 4) {
      const a = map(rad, CELL_SIZE, 0, 0, 40);
      fill(255, 200, 100, a);
      circle(zx + CELL_SIZE / 2, zy + CELL_SIZE / 2, rad * 2);
    }

    // Warm border
    fill(255, 180, 60, 20);
    rect(zx + 2, zy + 2, CELL_SIZE - 4, CELL_SIZE - 4);
  }

  // --- Scary zones ---
  for (const sz of scaryZones) {
    const zx = sz.c * CELL_SIZE;
    const zy = sz.r * CELL_SIZE;
    const a = (0.1 + sin(frameCount * 0.05) * 0.05) * 255;
    noStroke();
    fill(80, 0, 0, a);
    rect(zx, zy, CELL_SIZE, CELL_SIZE);
  }

  // --- End zone ---
  const endGlow = 0.3 + sin(frameCount * 0.06) * 0.15;
  const egx = (MAZE_COLS - 1) * CELL_SIZE;
  const egy = (MAZE_ROWS - 1) * CELL_SIZE;
  noStroke();
  fill(0, 200, 100, endGlow * 255);
  rect(egx + 4, egy + 4, CELL_SIZE - 8, CELL_SIZE - 8);
  noFill();
  stroke(0, 255, 120, (endGlow + 0.1) * 255);
  strokeWeight(2);
  rect(egx + 2, egy + 2, CELL_SIZE - 4, CELL_SIZE - 4);

  // --- Walls ---
  if (gameState === 'episode') {
    stroke(150 + random(50), 50 + random(30), 50 + random(30), 230);
  } else {
    const wc = 180 - darken * 40;
    stroke(wc, wc, wc + 10);
  }
  strokeWeight(3);

  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      const x = c * CELL_SIZE;
      const y = r * CELL_SIZE;
      const cell = maze[r][c];

      if (cell.top) line(x, y, x + CELL_SIZE, y);
      if (cell.right) line(x + CELL_SIZE, y, x + CELL_SIZE, y + CELL_SIZE);
      if (cell.bottom) line(x, y + CELL_SIZE, x + CELL_SIZE, y + CELL_SIZE);
      if (cell.left) line(x, y, x, y + CELL_SIZE);
    }
  }

  // --- Player ---
  const ch = characters[selectedChar];
  noStroke();
  fill(ch.color);
  circle(player.x, player.y, PLAYER_SIZE);

  // Player eyes
  fill(255);
  circle(player.x - 4, player.y - 3, 6);
  circle(player.x + 4, player.y - 3, 6);
  fill(17);
  circle(player.x - 4, player.y - 3, 3);
  circle(player.x + 4, player.y - 3, 3);

  pop();

  // --- Fog of war ---
  drawFog();

  // --- HUD ---
  drawHUD();

  // --- Episode overlay ---
  if (gameState === 'episode') {
    drawEpisodeOverlay();
  }

  // --- Micro spike flash ---
  if (microSpikeActive > 0) {
    noStroke();
    fill(255, 255, 255, (0.05 * microSpikeActive / 15) * 255);
    rect(0, 0, width, height);
  }
}

// ============================================================
// FOG OF WAR
// ============================================================
function drawFog() {
  // Resize fog buffer if needed
  if (fogBuffer.width !== width || fogBuffer.height !== height) {
    fogBuffer.resizeCanvas(width, height);
  }

  const stressRatio = stress / 100;
  let visRadius = BASE_VISIBILITY_RADIUS - stressRatio * (BASE_VISIBILITY_RADIUS - MIN_VISIBILITY_RADIUS);

  if (gameState === 'episode') {
    visRadius = MIN_VISIBILITY_RADIUS * 0.8;
    visRadius += sin(frameCount * 0.2) * 10;
  }

  // Use the underlying canvas context of the p5.Graphics buffer for gradient
  const fCtx = fogBuffer.drawingContext;
  fogBuffer.clear();

  // Fill with black
  fCtx.fillStyle = '#000';
  fCtx.fillRect(0, 0, fogBuffer.width, fogBuffer.height);

  // Cut out the visibility circle
  fCtx.globalCompositeOperation = 'destination-out';

  const gradient = fCtx.createRadialGradient(
    fogBuffer.width / 2, fogBuffer.height / 2, visRadius * 0.4,
    fogBuffer.width / 2, fogBuffer.height / 2, visRadius
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.9)');
  gradient.addColorStop(0.85, 'rgba(0, 0, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  fCtx.fillStyle = gradient;
  fCtx.fillRect(0, 0, fogBuffer.width, fogBuffer.height);

  fCtx.globalCompositeOperation = 'source-over';

  // Draw fog overlay onto main canvas
  image(fogBuffer, 0, 0);
}

// ============================================================
// HUD
// ============================================================
function drawHUD() {
  const padding = 20;
  const barWidth = 300;
  const barHeight = 20;

  // --- Stress meter ---
  const barX = (width - barWidth) / 2;
  const barY = height - padding - barHeight - 10;

  // Label
  textAlign(CENTER, CENTER);
  textStyle(NORMAL);
  textSize(12);
  fill(170);
  noStroke();
  text('STRESS', width / 2, barY - 10);

  // Bar background
  fill(40, 40, 40, 200);
  rect(barX, barY, barWidth, barHeight);

  // Bar fill
  const stressRatio = stress / 100;
  if (stressRatio < 0.4) fill(76, 175, 80);
  else if (stressRatio < 0.7) fill(255, 152, 0);
  else fill(244, 67, 54);

  // Pulsing when high
  if (stressRatio > 0.8) {
    const pulse = sin(frameCount * 0.15) * 0.3 + 0.7;
    drawingContext.globalAlpha = pulse;
  }
  rect(barX, barY, barWidth * stressRatio, barHeight);
  drawingContext.globalAlpha = 1;

  // Bar border
  noFill();
  stroke(102);
  strokeWeight(2);
  rect(barX, barY, barWidth, barHeight);

  // Stress percentage
  noStroke();
  textStyle(BOLD);
  textSize(12);
  fill(255);
  text(`${Math.floor(stress)}%`, width / 2, barY + barHeight / 2);

  // --- Timer ---
  const minutes = Math.floor(timer / 60);
  const seconds = Math.floor(timer % 60);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  textAlign(CENTER, CENTER);
  if (timer < 15) {
    fill(sin(frameCount * 0.2) > 0 ? color(244, 67, 54) : color(255, 102, 89));
    textStyle(BOLD);
    textSize(32);
  } else if (timer < 30) {
    fill(255, 152, 0);
    textStyle(BOLD);
    textSize(28);
  } else {
    fill(224);
    textStyle(BOLD);
    textSize(28);
  }
  text(timeStr, width / 2, padding + 20);

  // --- Zone indicator ---
  const { r, c } = getPlayerCell();
  const inCalmZone = calmZones.some(cz => cz.r === r && cz.c === c);
  if (inCalmZone) {
    textStyle(NORMAL);
    textSize(14);
    fill(255, 200, 100, 180);
    text('~ Calm Zone ~', width / 2, padding + 50);
  }
  const inScaryZone = scaryZones.some(sz => sz.r === r && sz.c === c);
  if (inScaryZone) {
    textStyle(NORMAL);
    textSize(14);
    fill(200, 50, 50, 180);
    text('! Danger Zone !', width / 2, padding + 50);
  }

  // --- Episode warning ---
  if (gameState === 'episode') {
    if (sin(frameCount * 0.2) > 0) {
      textStyle(BOLD);
      textSize(20);
      fill(255, 23, 68);
      text('!! EPISODE !!', width / 2, height / 2 - 60);
    }
    textStyle(NORMAL);
    textSize(13);
    fill(204);
    text('Controls inverted - Stop moving or find a calm zone', width / 2, height / 2 - 35);
  }

  // --- Controls reminder ---
  textAlign(LEFT, CENTER);
  textStyle(NORMAL);
  textSize(11);
  fill(150, 150, 150, 128);
  text('P = Pause | R = Restart | Shift = Run', padding, padding + 10);
}

// ============================================================
// EPISODE OVERLAY
// ============================================================
function drawEpisodeOverlay() {
  // Red vignette using drawingContext gradient
  const ctx = drawingContext;
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, 50,
    width / 2, height / 2, width / 2
  );
  gradient.addColorStop(0, 'rgba(50, 0, 0, 0)');
  gradient.addColorStop(0.6, 'rgba(50, 0, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(20, 0, 0, 0.7)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Scan lines
  noStroke();
  fill(0, 0, 0, 20);
  for (let y = 0; y < height; y += 4) {
    rect(0, y, width, 2);
  }
}

// ============================================================
// PAUSE OVERLAY
// ============================================================
function drawPauseOverlay() {
  noStroke();
  fill(0, 0, 0, 180);
  rect(0, 0, width, height);

  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(48);
  fill(224);
  text('PAUSED', width / 2, height / 2 - 20);

  textStyle(NORMAL);
  textSize(16);
  fill(170);
  text('Press P to resume | R to restart', width / 2, height / 2 + 30);
}

// ============================================================
// WIN SCREEN
// ============================================================
function drawWinScreen() {
  background(10, 26, 10);

  const cx = width / 2;
  const cy = height / 2;

  // Particles
  noStroke();
  for (let i = 0; i < 40; i++) {
    const angle = (frameCount * 0.02 + i * 0.16) % (TWO_PI);
    const d = 80 + sin(frameCount * 0.03 + i) * 40;
    const px = cx + cos(angle) * d;
    const py = cy - 50 + sin(angle) * d * 0.6;
    const a = (0.3 + sin(frameCount * 0.05 + i) * 0.2) * 255;
    fill(0, 200, 100, a);
    circle(px, py, 4);
  }

  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(52);
  fill(76, 175, 80);
  text('YOU MADE IT', cx, cy - 50);

  const timeLeft = Math.floor(timer);
  textStyle(NORMAL);
  textSize(18);
  fill(170);
  text(`You reached the end with ${timeLeft} seconds to spare.`, cx, cy + 10);
  text('You kept control through the chaos.', cx, cy + 40);

  textSize(14);
  fill(102);
  text('Press ENTER to return to menu | R to play again', cx, cy + 100);
}

// ============================================================
// LOSE SCREEN
// ============================================================
function drawLoseScreen() {
  background(26, 10, 10);

  const cx = width / 2;
  const cy = height / 2;

  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(52);
  fill(244, 67, 54);

  // Glitch effect
  const glitch = Math.random() < 0.1;
  if (glitch) {
    text("TIME'S UP", cx + (Math.random() - 0.5) * 8, cy - 50 + (Math.random() - 0.5) * 4);
  } else {
    text("TIME'S UP", cx, cy - 50);
  }

  textStyle(NORMAL);
  textSize(18);
  fill(170);
  text("You couldn't make it through in time.", cx, cy + 10);
  text('The maze consumed you.', cx, cy + 40);

  textSize(14);
  fill(102);
  text('Press ENTER to return to menu | R to try again', cx, cy + 100);
}
