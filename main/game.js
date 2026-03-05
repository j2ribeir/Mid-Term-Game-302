// ============================================================
// EPILEPSY AWARENESS MAZE GAME
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Canvas sizing ---
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

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
const GAME_TIME = 90; // seconds
const EPISODE_DURATION_MIN = 4;
const EPISODE_DURATION_MAX = 5;
const BASE_VISIBILITY_RADIUS = 260;
const MIN_VISIBILITY_RADIUS = 100;
const STRESS_PASSIVE_RATE = 0.03;       // per frame, time-based
const STRESS_RUN_RATE = 0.12;           // additional when running
const STRESS_NARROW_RATE = 0.08;        // additional in narrow zones
const STRESS_SCARY_RATE = 0.1;          // additional in scary zones
const STRESS_CALM_DRAIN = -0.25;        // drain in calm zones
const STRESS_STILL_DRAIN = -0.05;       // drain when standing still
const MICRO_SPIKE_CHANCE = 0.003;       // per frame chance
const MICRO_SPIKE_AMOUNT = 8;

// ============================================================
// GAME STATE
// ============================================================
let gameState = 'menu'; // menu, charSelect, playing, paused, episode, win, lose
let selectedChar = 0;
const characters = [
  { name: 'Alex', color: '#4fc3f7', accent: '#0288d1' },
  { name: 'Sam', color: '#ef5350', accent: '#c62828' },
  { name: 'Jordan', color: '#66bb6a', accent: '#2e7d32' },
];

let player = { x: 0, y: 0, vx: 0, vy: 0 };
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
let deltaTime = 0;
let keys = {};
let frameCount = 0;

// Audio context for sounds
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// ============================================================
// SOUND EFFECTS (procedural)
// ============================================================
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
    playTone(100 + Math.random() * 50, 0.05, 'triangle', 0.03);
  }
}

// ============================================================
// MAZE GENERATION (Recursive Backtracker)
// ============================================================
function generateMaze() {
  // Each cell: { top, right, bottom, left, visited }
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
      // Remove wall between current and next
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

  // Place start and end
  player.x = CELL_SIZE / 2;
  player.y = CELL_SIZE / 2;
  endPos.x = (MAZE_COLS - 1) * CELL_SIZE + CELL_SIZE / 2;
  endPos.y = (MAZE_ROWS - 1) * CELL_SIZE + CELL_SIZE / 2;

  // Generate calm zones (5-7 scattered)
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

  // Generate scary zones (6-10 scattered)
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

  // Detect narrow zones (cells with 3 walls = dead-end-ish)
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
  // Check all four corners of the player
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

  // Check wall collisions
  const margin = 2;
  // Check horizontal walls
  const cellR = Math.floor(ny / CELL_SIZE);
  const cellC = Math.floor(nx / CELL_SIZE);
  if (cellR < 0 || cellR >= MAZE_ROWS || cellC < 0 || cellC >= MAZE_COLS) return false;

  const cell = maze[cellR][cellC];
  const cellX = cellC * CELL_SIZE;
  const cellY = cellR * CELL_SIZE;

  // Top wall
  if (cell.top && ny - halfSize < cellY + margin) return false;
  // Bottom wall
  if (cell.bottom && ny + halfSize > cellY + CELL_SIZE - margin) return false;
  // Left wall
  if (cell.left && nx - halfSize < cellX + margin) return false;
  // Right wall
  if (cell.right && nx + halfSize > cellX + CELL_SIZE - margin) return false;

  return true;
}

// ============================================================
// INPUT HANDLING
// ============================================================
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  keys[e.code] = true;

  if (e.key === 'Enter') {
    if (gameState === 'menu') {
      gameState = 'charSelect';
    } else if (gameState === 'charSelect') {
      startGame();
    } else if (gameState === 'win' || gameState === 'lose') {
      gameState = 'menu';
    }
  }

  if (e.key.toLowerCase() === 'p' && (gameState === 'playing' || gameState === 'paused' || gameState === 'episode')) {
    if (gameState === 'paused') {
      gameState = 'playing';
    } else if (gameState === 'playing' || gameState === 'episode') {
      gameState = 'paused';
    }
  }

  if (e.key.toLowerCase() === 'r' && (gameState === 'playing' || gameState === 'paused' || gameState === 'episode' || gameState === 'win' || gameState === 'lose')) {
    startGame();
  }

  if (gameState === 'charSelect') {
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
      selectedChar = (selectedChar - 1 + characters.length) % characters.length;
    }
    if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
      selectedChar = (selectedChar + 1) % characters.length;
    }
  }

  e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  keys[e.code] = false;
});

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
  lastTime = performance.now();
}

// ============================================================
// UPDATE
// ============================================================
function update(timestamp) {
  deltaTime = (timestamp - lastTime) / 1000;
  if (deltaTime > 0.1) deltaTime = 0.1; // cap
  lastTime = timestamp;
  frameCount++;

  if (gameState === 'playing' || gameState === 'episode') {
    updatePlaying();
  }
}

function updatePlaying() {
  // --- Timer ---
  timer -= deltaTime;
  if (timer <= 0) {
    timer = 0;
    gameState = 'lose';
    playLoseSound();
    return;
  }

  // --- Movement ---
  let dx = 0, dy = 0;
  let up = keys['arrowup'] || keys['w'];
  let down = keys['arrowdown'] || keys['s'];
  let left = keys['arrowleft'] || keys['a'];
  let right = keys['arrowright'] || keys['d'];

  // Invert controls during episode
  if (controlsInverted) {
    [up, down] = [down, up];
    [left, right] = [right, left];
  }

  if (up) dy -= 1;
  if (down) dy += 1;
  if (left) dx -= 1;
  if (right) dx += 1;

  // Normalize diagonal
  if (dx !== 0 && dy !== 0) {
    dx *= 0.707;
    dy *= 0.707;
  }

  const isRunning = keys['shift'] || keys['ShiftLeft'] || keys['ShiftRight'];
  let speed = isRunning ? RUN_SPEED : PLAYER_SPEED;
  const isMoving = dx !== 0 || dy !== 0;

  // Episode slows movement
  if (gameState === 'episode') {
    speed *= 0.5;
    // Add movement delay/jitter
    if (frameCount % 4 < 2) {
      dx = 0;
      dy = 0;
    }
  }

  // Move with collision (try x then y separately for wall sliding)
  let nx = player.x + dx * speed;
  let ny = player.y + dy * speed;

  if (canMove(nx, player.y)) {
    player.x = nx;
  }
  if (canMove(player.x, ny)) {
    player.y = ny;
  }

  if (isMoving) playStepSound();

  // --- Zone detection ---
  const { r, c } = getPlayerCell();
  const inCalmZone = calmZones.some(cz => cz.r === r && cz.c === c);
  const inScaryZone = scaryZones.some(sz => sz.r === r && sz.c === c);
  const inNarrowZone = narrowZones.some(nz => nz.r === r && nz.c === c);

  // --- Stress ---
  if (gameState !== 'episode') {
    // Base stress increase over time
    stress += STRESS_PASSIVE_RATE * deltaTime * 60;

    if (isMoving && isRunning) stress += STRESS_RUN_RATE * deltaTime * 60;
    if (inNarrowZone) stress += STRESS_NARROW_RATE * deltaTime * 60;
    if (inScaryZone) stress += STRESS_SCARY_RATE * deltaTime * 60;
    if (inCalmZone) stress += STRESS_CALM_DRAIN * deltaTime * 60;
    if (!isMoving) stress += STRESS_STILL_DRAIN * deltaTime * 60;

    // Micro-spike events
    if (Math.random() < MICRO_SPIKE_CHANCE) {
      stress += MICRO_SPIKE_AMOUNT;
      microSpikeActive = 15; // frames
      playMicroSpikeSound();
    }

    stress = Math.max(0, Math.min(100, stress));

    // Trigger episode
    if (stress >= 100) {
      gameState = 'episode';
      controlsInverted = true;
      episodeDuration = EPISODE_DURATION_MIN + Math.random() * (EPISODE_DURATION_MAX - EPISODE_DURATION_MIN);
      episodeTimer = episodeDuration;
      playEpisodeSound();
    }
  } else {
    // Episode state
    episodeTimer -= deltaTime;
    // Screen shake
    screenShake.x = (Math.random() - 0.5) * 12;
    screenShake.y = (Math.random() - 0.5) * 12;

    // Exit episode
    const playerStopped = !isMoving;
    if (episodeTimer <= 0 || (playerStopped && episodeTimer < episodeDuration - 1) || inCalmZone) {
      gameState = 'playing';
      controlsInverted = false;
      stress = 60; // drop stress after episode
      screenShake = { x: 0, y: 0 };
    }
  }

  // Micro spike visual timer
  if (microSpikeActive > 0) microSpikeActive--;

  // --- Win condition ---
  const distToEnd = Math.hypot(player.x - endPos.x, player.y - endPos.y);
  if (distToEnd < CELL_SIZE / 2) {
    gameState = 'win';
    playWinSound();
  }
}

// ============================================================
// RENDER
// ============================================================
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gameState === 'menu') {
    drawMenu();
  } else if (gameState === 'charSelect') {
    drawCharSelect();
  } else if (gameState === 'playing' || gameState === 'episode') {
    drawGame();
  } else if (gameState === 'paused') {
    drawGame();
    drawPauseOverlay();
  } else if (gameState === 'win') {
    drawWinScreen();
  } else if (gameState === 'lose') {
    drawLoseScreen();
  }
}

// --- Menu ---
function drawMenu() {
  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Animated background particles
  for (let i = 0; i < 30; i++) {
    const x = (Math.sin(frameCount * 0.01 + i * 1.5) * 0.5 + 0.5) * canvas.width;
    const y = (Math.cos(frameCount * 0.008 + i * 2.1) * 0.5 + 0.5) * canvas.height;
    const alpha = 0.05 + Math.sin(frameCount * 0.02 + i) * 0.03;
    ctx.fillStyle = `rgba(100, 100, 120, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 2 + Math.sin(frameCount * 0.03 + i) * 1, 0, Math.PI * 2);
    ctx.fill();
  }

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Title
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e0e0e0';
  ctx.font = 'bold 52px Courier New';
  ctx.fillText('LOST CONTROL', cx, cy - 100);

  // Subtitle
  ctx.fillStyle = '#888';
  ctx.font = '18px Courier New';
  ctx.fillText('An Epilepsy Awareness Experience', cx, cy - 60);

  // Flicker effect on subtitle
  if (Math.random() < 0.05) {
    ctx.fillStyle = '#fff';
    ctx.fillText('An Epilepsy Awareness Experience', cx, cy - 60);
  }

  // Instructions
  ctx.fillStyle = '#aaa';
  ctx.font = '16px Courier New';
  ctx.fillText('You are on a journey but terrified of what\'s to come.', cx, cy + 10);
  ctx.fillText('Navigate the maze before time runs out.', cx, cy + 35);
  ctx.fillText('But beware... you might lose control.', cx, cy + 60);

  // Prompt
  const blink = Math.sin(frameCount * 0.08) > 0;
  if (blink) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px Courier New';
    ctx.fillText('[ PRESS ENTER TO START ]', cx, cy + 130);
  }

  // Controls hint
  ctx.fillStyle = '#555';
  ctx.font = '13px Courier New';
  ctx.fillText('WASD / Arrow Keys = Move  |  Shift = Run  |  P = Pause  |  R = Restart', cx, canvas.height - 30);
}

// --- Character Select ---
function drawCharSelect() {
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e0e0e0';
  ctx.font = 'bold 36px Courier New';
  ctx.fillText('CHOOSE YOUR CHARACTER', cx, cy - 120);

  ctx.fillStyle = '#888';
  ctx.font = '14px Courier New';
  ctx.fillText('Use LEFT / RIGHT arrow keys to select, ENTER to confirm', cx, cy - 80);

  // Draw characters
  const spacing = 160;
  const startX = cx - spacing;
  for (let i = 0; i < characters.length; i++) {
    const x = startX + i * spacing;
    const y = cy + 10;
    const ch = characters[i];
    const selected = i === selectedChar;

    // Selection highlight
    if (selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 45, y - 55, 90, 110);

      // Arrow indicators
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px Courier New';
      ctx.fillText('>', x + 55, y + 5);
      ctx.fillText('<', x - 55, y + 5);
    }

    // Character body
    ctx.fillStyle = ch.color;
    ctx.beginPath();
    ctx.arc(x, y - 15, 22, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 7, y - 20, 5, 0, Math.PI * 2);
    ctx.arc(x + 7, y - 20, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x - 6, y - 19, 2.5, 0, Math.PI * 2);
    ctx.arc(x + 8, y - 19, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Name
    ctx.fillStyle = selected ? '#fff' : '#888';
    ctx.font = selected ? 'bold 16px Courier New' : '16px Courier New';
    ctx.fillText(ch.name, x, y + 45);
  }
}

// --- Game Drawing ---
function drawGame() {
  ctx.save();

  // Camera offset (center player on screen)
  let camX = player.x - canvas.width / 2;
  let camY = player.y - canvas.height / 2;

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

  ctx.translate(-camX, -camY);

  // --- Draw maze background ---
  // Darkening based on stress
  const darken = stress / 100;
  const baseBg = Math.floor(70 - darken * 30);
  ctx.fillStyle = `rgb(${baseBg}, ${baseBg}, ${baseBg + 8})`;
  ctx.fillRect(0, 0, MAZE_WIDTH, MAZE_HEIGHT);

  // --- Draw calm zones ---
  for (const cz of calmZones) {
    const zx = cz.c * CELL_SIZE;
    const zy = cz.r * CELL_SIZE;
    const gradient = ctx.createRadialGradient(
      zx + CELL_SIZE / 2, zy + CELL_SIZE / 2, 5,
      zx + CELL_SIZE / 2, zy + CELL_SIZE / 2, CELL_SIZE
    );
    gradient.addColorStop(0, 'rgba(255, 200, 100, 0.15)');
    gradient.addColorStop(1, 'rgba(255, 200, 100, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(zx - CELL_SIZE / 2, zy - CELL_SIZE / 2, CELL_SIZE * 2, CELL_SIZE * 2);

    // Warm border glow
    ctx.fillStyle = 'rgba(255, 180, 60, 0.08)';
    ctx.fillRect(zx + 2, zy + 2, CELL_SIZE - 4, CELL_SIZE - 4);
  }

  // --- Draw scary zones ---
  for (const sz of scaryZones) {
    const zx = sz.c * CELL_SIZE;
    const zy = sz.r * CELL_SIZE;
    ctx.fillStyle = `rgba(80, 0, 0, ${0.1 + Math.sin(frameCount * 0.05) * 0.05})`;
    ctx.fillRect(zx, zy, CELL_SIZE, CELL_SIZE);
  }

  // --- Draw end zone ---
  const endGlow = 0.3 + Math.sin(frameCount * 0.06) * 0.15;
  const egx = (MAZE_COLS - 1) * CELL_SIZE;
  const egy = (MAZE_ROWS - 1) * CELL_SIZE;
  ctx.fillStyle = `rgba(0, 200, 100, ${endGlow})`;
  ctx.fillRect(egx + 4, egy + 4, CELL_SIZE - 8, CELL_SIZE - 8);
  ctx.strokeStyle = `rgba(0, 255, 120, ${endGlow + 0.1})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(egx + 2, egy + 2, CELL_SIZE - 4, CELL_SIZE - 4);

  // --- Draw walls ---
  const wallColor = gameState === 'episode' ?
    `rgba(${150 + Math.random() * 50}, ${50 + Math.random() * 30}, ${50 + Math.random() * 30}, 0.9)` :
    `rgba(${180 - darken * 40}, ${180 - darken * 40}, ${190 - darken * 40}, 1)`;
  ctx.strokeStyle = wallColor;
  ctx.lineWidth = 3;

  for (let r = 0; r < MAZE_ROWS; r++) {
    for (let c = 0; c < MAZE_COLS; c++) {
      const x = c * CELL_SIZE;
      const y = r * CELL_SIZE;
      const cell = maze[r][c];

      if (cell.top) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + CELL_SIZE, y);
        ctx.stroke();
      }
      if (cell.right) {
        ctx.beginPath();
        ctx.moveTo(x + CELL_SIZE, y);
        ctx.lineTo(x + CELL_SIZE, y + CELL_SIZE);
        ctx.stroke();
      }
      if (cell.bottom) {
        ctx.beginPath();
        ctx.moveTo(x, y + CELL_SIZE);
        ctx.lineTo(x + CELL_SIZE, y + CELL_SIZE);
        ctx.stroke();
      }
      if (cell.left) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + CELL_SIZE);
        ctx.stroke();
      }
    }
  }

  // --- Draw player ---
  const ch = characters[selectedChar];
  ctx.fillStyle = ch.color;
  ctx.beginPath();
  ctx.arc(player.x, player.y, PLAYER_SIZE / 2, 0, Math.PI * 2);
  ctx.fill();

  // Player eyes
  const eyeOffX = player.vx !== 0 ? Math.sign(player.vx) * 2 : 0;
  const eyeOffY = player.vy !== 0 ? Math.sign(player.vy) * 2 : 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(player.x - 4, player.y - 3, 3, 0, Math.PI * 2);
  ctx.arc(player.x + 4, player.y - 3, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(player.x - 4 + eyeOffX, player.y - 3 + eyeOffY, 1.5, 0, Math.PI * 2);
  ctx.arc(player.x + 4 + eyeOffX, player.y - 3 + eyeOffY, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // --- FOG OF WAR (visibility circle) ---
  drawFog();

  // --- HUD ---
  drawHUD();

  // --- Episode overlay ---
  if (gameState === 'episode') {
    drawEpisodeOverlay();
  }

  // --- Micro spike blur ---
  if (microSpikeActive > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.05 * microSpikeActive / 15})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// Offscreen canvas for fog
const fogCanvas = document.createElement('canvas');
const fogCtx = fogCanvas.getContext('2d');

function drawFog() {
  // Sync offscreen canvas size
  if (fogCanvas.width !== canvas.width || fogCanvas.height !== canvas.height) {
    fogCanvas.width = canvas.width;
    fogCanvas.height = canvas.height;
  }

  // Calculate visibility radius based on stress
  const stressRatio = stress / 100;
  let visRadius = BASE_VISIBILITY_RADIUS - stressRatio * (BASE_VISIBILITY_RADIUS - MIN_VISIBILITY_RADIUS);

  if (gameState === 'episode') {
    visRadius = MIN_VISIBILITY_RADIUS * 0.8;
    // Pulsating during episode
    visRadius += Math.sin(frameCount * 0.2) * 10;
  }

  // Draw fog on offscreen canvas
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);

  // Fill with black
  fogCtx.fillStyle = '#000';
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);

  // Cut out the visibility circle
  fogCtx.globalCompositeOperation = 'destination-out';

  const gradient = fogCtx.createRadialGradient(
    fogCanvas.width / 2, fogCanvas.height / 2, visRadius * 0.4,
    fogCanvas.width / 2, fogCanvas.height / 2, visRadius
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.9)');
  gradient.addColorStop(0.85, 'rgba(0, 0, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  fogCtx.fillStyle = gradient;
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);

  fogCtx.globalCompositeOperation = 'source-over';

  // Composite the fog overlay onto the main canvas
  ctx.drawImage(fogCanvas, 0, 0);
}

function drawHUD() {
  const padding = 20;
  const barWidth = 300;
  const barHeight = 20;

  // --- Stress meter (bottom center) ---
  const barX = (canvas.width - barWidth) / 2;
  const barY = canvas.height - padding - barHeight - 10;

  // Label
  ctx.textAlign = 'center';
  ctx.fillStyle = '#aaa';
  ctx.font = '12px Courier New';
  ctx.fillText('STRESS', canvas.width / 2, barY - 5);

  // Bar background
  ctx.fillStyle = 'rgba(40, 40, 40, 0.8)';
  ctx.fillRect(barX, barY, barWidth, barHeight);

  // Bar fill
  const stressRatio = stress / 100;
  let barColor;
  if (stressRatio < 0.4) barColor = '#4caf50';
  else if (stressRatio < 0.7) barColor = '#ff9800';
  else barColor = '#f44336';

  // Pulsing when high
  if (stressRatio > 0.8) {
    const pulse = Math.sin(frameCount * 0.15) * 0.3 + 0.7;
    ctx.globalAlpha = pulse;
  }
  ctx.fillStyle = barColor;
  ctx.fillRect(barX, barY, barWidth * stressRatio, barHeight);
  ctx.globalAlpha = 1;

  // Bar border
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  // Stress percentage
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px Courier New';
  ctx.fillText(`${Math.floor(stress)}%`, canvas.width / 2, barY + 15);

  // --- Timer (top center) ---
  const minutes = Math.floor(timer / 60);
  const seconds = Math.floor(timer % 60);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  ctx.textAlign = 'center';
  if (timer < 15) {
    ctx.fillStyle = Math.sin(frameCount * 0.2) > 0 ? '#f44336' : '#ff6659';
    ctx.font = 'bold 32px Courier New';
  } else if (timer < 30) {
    ctx.fillStyle = '#ff9800';
    ctx.font = 'bold 28px Courier New';
  } else {
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 28px Courier New';
  }
  ctx.fillText(timeStr, canvas.width / 2, padding + 30);

  // --- Zone indicator ---
  const { r, c } = getPlayerCell();
  const inCalmZone = calmZones.some(cz => cz.r === r && cz.c === c);
  if (inCalmZone) {
    ctx.fillStyle = 'rgba(255, 200, 100, 0.7)';
    ctx.font = '14px Courier New';
    ctx.fillText('~ Calm Zone ~', canvas.width / 2, padding + 55);
  }
  const inScaryZone = scaryZones.some(sz => sz.r === r && sz.c === c);
  if (inScaryZone) {
    ctx.fillStyle = 'rgba(200, 50, 50, 0.7)';
    ctx.font = '14px Courier New';
    ctx.fillText('! Danger Zone !', canvas.width / 2, padding + 55);
  }

  // --- Episode warning ---
  if (gameState === 'episode') {
    const blink = Math.sin(frameCount * 0.2) > 0;
    if (blink) {
      ctx.fillStyle = '#ff1744';
      ctx.font = 'bold 20px Courier New';
      ctx.fillText('!! EPISODE !!', canvas.width / 2, canvas.height / 2 - 60);
    }
    ctx.fillStyle = '#ccc';
    ctx.font = '13px Courier New';
    ctx.fillText('Controls inverted - Stop moving or find a calm zone', canvas.width / 2, canvas.height / 2 - 35);
  }

  // --- Controls reminder (top left) ---
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(150, 150, 150, 0.5)';
  ctx.font = '11px Courier New';
  ctx.fillText('P = Pause | R = Restart | Shift = Run', padding, padding + 15);
}

function drawEpisodeOverlay() {
  // Red/dark vignette
  const gradient = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 50,
    canvas.width / 2, canvas.height / 2, canvas.width / 2
  );
  gradient.addColorStop(0, 'rgba(50, 0, 0, 0)');
  gradient.addColorStop(0.6, 'rgba(50, 0, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(20, 0, 0, 0.7)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Scan lines
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  for (let y = 0; y < canvas.height; y += 4) {
    ctx.fillRect(0, y, canvas.width, 2);
  }
}

function drawPauseOverlay() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e0e0e0';
  ctx.font = 'bold 48px Courier New';
  ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2 - 20);

  ctx.fillStyle = '#aaa';
  ctx.font = '16px Courier New';
  ctx.fillText('Press P to resume | R to restart', canvas.width / 2, canvas.height / 2 + 30);
}

function drawWinScreen() {
  ctx.fillStyle = '#0a1a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // Particles
  for (let i = 0; i < 40; i++) {
    const angle = (frameCount * 0.02 + i * 0.16) % (Math.PI * 2);
    const dist = 80 + Math.sin(frameCount * 0.03 + i) * 40;
    const px = cx + Math.cos(angle) * dist;
    const py = cy - 50 + Math.sin(angle) * dist * 0.6;
    ctx.fillStyle = `rgba(0, 200, 100, ${0.3 + Math.sin(frameCount * 0.05 + i) * 0.2})`;
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#4caf50';
  ctx.font = 'bold 52px Courier New';
  ctx.fillText('YOU MADE IT', cx, cy - 50);

  const timeLeft = Math.floor(timer);
  ctx.fillStyle = '#aaa';
  ctx.font = '18px Courier New';
  ctx.fillText(`You reached the end with ${timeLeft} seconds to spare.`, cx, cy + 10);
  ctx.fillText('You kept control through the chaos.', cx, cy + 40);

  ctx.fillStyle = '#666';
  ctx.font = '14px Courier New';
  ctx.fillText('Press ENTER to return to menu | R to play again', cx, cy + 100);
}

function drawLoseScreen() {
  ctx.fillStyle = '#1a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f44336';
  ctx.font = 'bold 52px Courier New';

  // Glitch effect on text
  const glitch = Math.random() < 0.1;
  if (glitch) {
    ctx.fillText('TIME\'S UP', cx + (Math.random() - 0.5) * 8, cy - 50 + (Math.random() - 0.5) * 4);
  } else {
    ctx.fillText('TIME\'S UP', cx, cy - 50);
  }

  ctx.fillStyle = '#aaa';
  ctx.font = '18px Courier New';
  ctx.fillText('You couldn\'t make it through in time.', cx, cy + 10);
  ctx.fillText('The maze consumed you.', cx, cy + 40);

  ctx.fillStyle = '#666';
  ctx.font = '14px Courier New';
  ctx.fillText('Press ENTER to return to menu | R to try again', cx, cy + 100);
}

// ============================================================
// GAME LOOP
// ============================================================
function gameLoop(timestamp) {
  update(timestamp);
  render();
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
