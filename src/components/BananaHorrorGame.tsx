import { useEffect, useRef, useState, useCallback } from "react";

// ============================================================================
// Lightweight Audio Engine
// ============================================================================

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  bgmGain: GainNode | null = null;
  droneGain: GainNode | null = null;
  heartGain: GainNode | null = null;
  proximityGain: GainNode | null = null;
  sfxGain: GainNode | null = null;
  proximityPanner: StereoPannerNode | null = null;
  proximityFilter: BiquadFilterNode | null = null;
  heartTimer: number | null = null;
  heartRate = 60;
  started = false;

  async start() {
    if (this.started) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctx();
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }

      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);

      // Buses (no convolver - too heavy on mobile)
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.15;
      this.bgmGain.connect(this.master);

      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0.1;
      this.droneGain.connect(this.master);

      this.heartGain = this.ctx.createGain();
      this.heartGain.gain.value = 0.5;
      this.heartGain.connect(this.master);

      this.proximityGain = this.ctx.createGain();
      this.proximityGain.gain.value = 0;
      this.proximityPanner = this.ctx.createStereoPanner();
      this.proximityFilter = this.ctx.createBiquadFilter();
      this.proximityFilter.type = "lowpass";
      this.proximityFilter.frequency.value = 800;
      this.proximityGain.connect(this.proximityFilter);
      this.proximityFilter.connect(this.proximityPanner);
      this.proximityPanner.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.5;
      this.sfxGain.connect(this.master);

      this.startBGM();
      this.startDrone();
      this.startProximity();
      this.scheduleHeartbeat();
      this.started = true;
    } catch (e) {
      console.error("AudioEngine start failed:", e);
      // mark started anyway so the game can run silently
      this.started = true;
    }
  }

  startBGM() {
    if (!this.ctx || !this.bgmGain) return;
    // Just 2 oscillators - lighter
    const freqs = [110, 164.81];
    freqs.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 6;
      osc.connect(this.bgmGain!);
      osc.start();
    });
  }

  startDrone() {
    if (!this.ctx || !this.droneGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 200;
    osc.connect(filter).connect(this.droneGain);
    osc.start();
  }

  startProximity() {
    if (!this.ctx || !this.proximityGain) return;
    // Short 1s noise loop - lighter memory
    const buf = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate,
      this.ctx.sampleRate,
    );
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.proximityGain);
    src.start();
  }

  setProximity(level: number, pan: number) {
    if (!this.ctx || !this.proximityGain || !this.proximityPanner || !this.proximityFilter)
      return;
    const t = this.ctx.currentTime;
    try {
      this.proximityGain.gain.setTargetAtTime(
        Math.min(0.4, level * 0.4),
        t,
        0.15,
      );
      this.proximityPanner.pan.setTargetAtTime(pan, t, 0.15);
      this.proximityFilter.frequency.setTargetAtTime(
        400 + level * 2000,
        t,
        0.15,
      );
    } catch {
      /* ignore */
    }
    this.heartRate = 55 + level * 90;
  }

  scheduleHeartbeat() {
    const tick = () => {
      this.beatHeart();
      this.heartTimer = window.setTimeout(tick, 60000 / this.heartRate);
    };
    tick();
  }

  beatHeart() {
    if (!this.ctx || !this.heartGain) return;
    const t = this.ctx.currentTime;
    const beat = (offset: number, vol: number) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(80, t + offset);
      osc.frequency.exponentialRampToValueAtTime(35, t + offset + 0.12);
      g.gain.setValueAtTime(0.001, t + offset);
      g.gain.linearRampToValueAtTime(vol, t + offset + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.15);
      osc.connect(g).connect(this.heartGain!);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    };
    beat(0, 0.5);
    beat(0.18, 0.35);
  }

  playPickup() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, t + i * 0.07);
      g.gain.setValueAtTime(0.001, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.35);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.4);
    });
  }

  playGameOver() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 1.2);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 1.3);
  }

  playWin() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.001, t + i * 0.15);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.5);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.6);
    });
  }

  speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      u.rate = 0.9;
      u.pitch = 0.7;
      u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }

  setMix(name: "master" | "bgm" | "drone" | "heart" | "sfx", v: number) {
    const map: Record<string, GainNode | null> = {
      master: this.master,
      bgm: this.bgmGain,
      drone: this.droneGain,
      heart: this.heartGain,
      sfx: this.sfxGain,
    };
    const node = map[name];
    if (node && this.ctx) {
      try {
        node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
      } catch {
        node.gain.value = v;
      }
    }
  }
}

// ============================================================================
// Game (lighter: 18x12 grid, smaller canvas)
// ============================================================================

const TILE = 28;
const COLS = 20;
const ROWS = 14;
const W = TILE * COLS;
const H = TILE * ROWS;

type Vec = { x: number; y: number };

export type EnemyKind = "banana" | "apple" | "chicken" | "fish";

export interface Enemy {
  kind: EnemyKind;
  pos: Vec;
  lastMoveAt: number;
  // for fish: cooldown until next teleport
  nextTeleport?: number;
}

const ENEMY_BASE_SPEED: Record<EnemyKind, number> = {
  banana: 1.0, // 1.0x base
  apple: 1.6, // slow patroller
  chicken: 0.9, // jittery, slightly faster
  fish: 0.55, // very fast
};

const ENEMY_LABEL: Record<EnemyKind, string> = {
  banana: "🍌 髪バナナ",
  apple: "🍏 殺人りんご",
  chicken: "🐔 狂チキン",
  fish: "🐟 高速サカナ",
};

export interface Difficulty {
  id: string;
  label: string;
  apples: number;
  enemySpeedMs: number; // base for banana
  enemies: Partial<Record<EnemyKind, number>>;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: "easy",
    label: "イージー 🍮",
    apples: 3,
    enemySpeedMs: 520,
    enemies: { banana: 1 },
  },
  {
    id: "normal",
    label: "ノーマル 🍌",
    apples: 5,
    enemySpeedMs: 360,
    enemies: { banana: 1, apple: 1 },
  },
  {
    id: "hard",
    label: "ハード 🔥",
    apples: 7,
    enemySpeedMs: 260,
    enemies: { banana: 2, apple: 1, chicken: 1 },
  },
  {
    id: "nightmare",
    label: "ナイトメア 💀",
    apples: 10,
    enemySpeedMs: 180,
    enemies: { banana: 2, apple: 2, chicken: 2, fish: 1 },
  },
  {
    id: "hell",
    label: "地獄 👹",
    apples: 15,
    enemySpeedMs: 130,
    enemies: { banana: 3, apple: 3, chicken: 3, fish: 2 },
  },
  {
    id: "chaos",
    label: "カオス 🌀",
    apples: 20,
    enemySpeedMs: 100,
    enemies: { banana: 4, apple: 4, chicken: 4, fish: 3 },
  },
  {
    id: "custom",
    label: "カスタム ⚙️",
    apples: 5,
    enemySpeedMs: 320,
    enemies: { banana: 1 },
  },
];

interface GameState {
  player: Vec;
  enemies: Enemy[];
  apples: Vec[];
  walls: Set<string>;
  collected: number;
  status: "playing" | "won" | "lost";
  hidden: boolean;
  totalApples: number;
}

function generateLevel(
  appleCount: number,
  enemyCounts: Partial<Record<EnemyKind, number>>,
): GameState {
  const walls = new Set<string>();
  for (let x = 0; x < COLS; x++) {
    walls.add(`${x},0`);
    walls.add(`${x},${ROWS - 1}`);
  }
  for (let y = 0; y < ROWS; y++) {
    walls.add(`0,${y}`);
    walls.add(`${COLS - 1},${y}`);
  }
  for (let i = 0; i < 28; i++) {
    const x = 2 + Math.floor(Math.random() * (COLS - 4));
    const y = 2 + Math.floor(Math.random() * (ROWS - 4));
    walls.add(`${x},${y}`);
    if (Math.random() > 0.5) walls.add(`${x + 1},${y}`);
  }

  const freeCell = (): Vec => {
    for (let i = 0; i < 300; i++) {
      const x = 1 + Math.floor(Math.random() * (COLS - 2));
      const y = 1 + Math.floor(Math.random() * (ROWS - 2));
      if (!walls.has(`${x},${y}`)) return { x, y };
    }
    return { x: 1, y: 1 };
  };

  const player = freeCell();
  walls.delete(`${player.x},${player.y}`);

  const apples: Vec[] = [];
  let attempts = 0;
  while (apples.length < appleCount && attempts++ < 1500) {
    const c = freeCell();
    if (Math.abs(c.x - player.x) + Math.abs(c.y - player.y) < 4) continue;
    if (apples.some((a) => a.x === c.x && a.y === c.y)) continue;
    apples.push(c);
  }

  const enemies: Enemy[] = [];
  (Object.keys(enemyCounts) as EnemyKind[]).forEach((kind) => {
    const n = enemyCounts[kind] ?? 0;
    for (let i = 0; i < n; i++) {
      let pos = freeCell();
      for (let j = 0; j < 60; j++) {
        if (Math.abs(pos.x - player.x) + Math.abs(pos.y - player.y) >= 6) break;
        pos = freeCell();
      }
      enemies.push({ kind, pos, lastMoveAt: 0 });
    }
  });

  return {
    player,
    enemies,
    apples,
    walls,
    collected: 0,
    status: "playing",
    hidden: false,
    totalApples: apples.length,
  };
}

// BFS for enemy AI
function nextStepToward(
  from: Vec,
  to: Vec,
  walls: Set<string>,
): Vec | null {
  const key = (v: Vec) => `${v.x},${v.y}`;
  const visited = new Set<string>([key(from)]);
  const queue: { v: Vec; first: Vec | null }[] = [{ v: from, first: null }];
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  let iter = 0;
  while (queue.length && iter++ < 400) {
    const { v, first } = queue.shift()!;
    if (v.x === to.x && v.y === to.y) return first;
    for (const d of dirs) {
      const nv = { x: v.x + d.x, y: v.y + d.y };
      const k = key(nv);
      if (visited.has(k)) continue;
      if (walls.has(k)) continue;
      visited.add(k);
      queue.push({ v: nv, first: first ?? nv });
    }
  }
  return null;
}

function randomFreeNeighbor(from: Vec, walls: Set<string>): Vec | null {
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const shuffled = dirs.sort(() => Math.random() - 0.5);
  for (const d of shuffled) {
    const nv = { x: from.x + d.x, y: from.y + d.y };
    if (!walls.has(`${nv.x},${nv.y}`)) return nv;
  }
  return null;
}

function stepEnemy(
  enemy: Enemy,
  player: Vec,
  walls: Set<string>,
  now: number,
): Vec {
  const k = enemy.kind;
  if (k === "banana") {
    return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
  }
  if (k === "apple") {
    // Mostly random patrol, 30% chance to chase
    if (Math.random() < 0.3) {
      return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
    }
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "chicken") {
    // Erratic: 60% random, 40% chase
    if (Math.random() < 0.4) {
      return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
    }
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "fish") {
    // Very fast chaser, occasionally teleports near player
    if (
      enemy.nextTeleport !== undefined &&
      now > enemy.nextTeleport &&
      Math.random() < 0.3
    ) {
      enemy.nextTeleport = now + 4000 + Math.random() * 3000;
      // teleport to a free cell within 5 tiles of player
      for (let i = 0; i < 30; i++) {
        const tx =
          player.x + Math.floor((Math.random() - 0.5) * 10);
        const ty =
          player.y + Math.floor((Math.random() - 0.5) * 10);
        if (
          tx > 0 &&
          tx < COLS - 1 &&
          ty > 0 &&
          ty < ROWS - 1 &&
          !walls.has(`${tx},${ty}`) &&
          (Math.abs(tx - player.x) + Math.abs(ty - player.y)) >= 2
        ) {
          return { x: tx, y: ty };
        }
      }
    }
    return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
  }
  return enemy.pos;
}

export function BananaHorrorGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const [difficultyId, setDifficultyId] = useState<string>("normal");
  const [customApples, setCustomApples] = useState(5);
  const [customSpeed, setCustomSpeed] = useState(320);
  const [customEnemies, setCustomEnemies] = useState<
    Record<EnemyKind, number>
  >({ banana: 1, apple: 0, chicken: 0, fish: 0 });

  const getActiveDifficulty = useCallback((): Difficulty => {
    const d = DIFFICULTIES.find((x) => x.id === difficultyId) ?? DIFFICULTIES[1];
    if (d.id === "custom") {
      return {
        ...d,
        apples: customApples,
        enemySpeedMs: customSpeed,
        enemies: customEnemies,
      };
    }
    return d;
  }, [difficultyId, customApples, customSpeed, customEnemies]);

  const stateRef = useRef<GameState>(generateLevel(5, { banana: 1 }));
  const enemySpeedRef = useRef(320);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastMoveRef = useRef(0);
  const lastEnemyRef = useRef(0);

  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((v) => v + 1), []);

  const [mix, setMix] = useState({
    master: 0.7,
    bgm: 0.15,
    drone: 0.1,
    heart: 0.5,
    sfx: 0.5,
  });

  const handleStart = async () => {
    if (starting || started) return;
    setStarting(true);
    try {
      const d = getActiveDifficulty();
      stateRef.current = generateLevel(d.apples, d.enemies);
      enemySpeedRef.current = d.enemySpeedMs;
      if (!engineRef.current) engineRef.current = new AudioEngine();
      await engineRef.current.start();
      setStarted(true);
      const enemyTypes = (Object.keys(d.enemies) as EnemyKind[])
        .filter((k) => (d.enemies[k] ?? 0) > 0)
        .map((k) => ENEMY_LABEL[k])
        .join("、");
      setTimeout(() => {
        engineRef.current?.speak(
          `${enemyTypes}が、追いかけてくる。りんごを${d.apples}つ集めなさい。`,
        );
      }, 300);
    } catch (e) {
      console.error("start failed", e);
      setStarted(true);
    } finally {
      setStarting(false);
    }
  };

  // Mixer
  useEffect(() => {
    if (!started || !engineRef.current) return;
    (Object.keys(mix) as (keyof typeof mix)[]).forEach((k) => {
      engineRef.current!.setMix(k, mix[k]);
    });
  }, [mix, started]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      if (
        e.key === " " ||
        e.key.startsWith("Arrow")
      ) {
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Touch controls (mobile)
  const move = useCallback((dx: number, dy: number) => {
    const s = stateRef.current;
    if (s.status !== "playing") return;
    const nx = s.player.x + dx;
    const ny = s.player.y + dy;
    if (s.walls.has(`${nx},${ny}`)) return;
    s.player = { x: nx, y: ny };
    const idx = s.apples.findIndex((a) => a.x === nx && a.y === ny);
    if (idx >= 0) {
      s.apples.splice(idx, 1);
      s.collected++;
      engineRef.current?.playPickup();
      if (s.collected >= s.totalApples) {
        s.status = "won";
        engineRef.current?.playWin();
        engineRef.current?.speak("脱出、成功。");
      }
      rerender();
    }
  }, [rerender]);

  // Game loop
  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastFrame = 0;
    const tick = (now: number) => {
      // Cap to ~30fps for performance
      if (now - lastFrame < 33) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;

      const s = stateRef.current;

      if (s.status === "playing") {
        // Player input (keyboard)
        if (now - lastMoveRef.current > 140) {
          let dx = 0, dy = 0;
          const k = keysRef.current;
          if (k["arrowup"] || k["w"]) dy = -1;
          else if (k["arrowdown"] || k["s"]) dy = 1;
          else if (k["arrowleft"] || k["a"]) dx = -1;
          else if (k["arrowright"] || k["d"]) dx = 1;
          if (dx || dy) {
            move(dx, dy);
            lastMoveRef.current = now;
          }
          s.hidden = !!k["shift"];
        }

        // Enemies — each enemy has its own movement timer based on its kind
        const baseSpeed = enemySpeedRef.current;
        for (const enemy of s.enemies) {
          const kindMul = ENEMY_BASE_SPEED[enemy.kind];
          const speedMs =
            baseSpeed * kindMul * (s.hidden ? 2.0 : 1);
          if (now - enemy.lastMoveAt > speedMs) {
            const next = stepEnemy(enemy, s.player, s.walls, now);
            enemy.pos = next;
            enemy.lastMoveAt = now;
            if (enemy.pos.x === s.player.x && enemy.pos.y === s.player.y) {
              s.status = "lost";
              engineRef.current?.playGameOver();
              engineRef.current?.speak(
                `${ENEMY_LABEL[enemy.kind]}に、つかまった。`,
              );
              rerender();
              break;
            }
          }
        }

        // Proximity audio — use closest enemy
        let nearestDx = 99,
          nearestDy = 99,
          nearestDist = 99;
        for (const enemy of s.enemies) {
          const dx = enemy.pos.x - s.player.x;
          const dy = enemy.pos.y - s.player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestDx = dx;
            nearestDy = dy;
          }
        }
        const level = Math.max(0, 1 - nearestDist / 12);
        const pan = Math.max(-1, Math.min(1, nearestDx / 7));
        // suppress unused dy warning
        void nearestDy;
        engineRef.current?.setProximity(level * (s.hidden ? 0.4 : 1), pan);
      }

      // Render (simplified)
      ctx.fillStyle = "#0a0805";
      ctx.fillRect(0, 0, W, H);

      // Floor + walls in one pass
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (s.walls.has(`${x},${y}`)) {
            ctx.fillStyle = "#3a1a1a";
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          } else {
            ctx.fillStyle = (x + y) % 2 === 0 ? "#1a1410" : "#221a14";
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
        }
      }

      // Apples
      const pulse = 1 + Math.sin(now / 250) * 0.12;
      ctx.fillStyle = "#e63946";
      s.apples.forEach((a) => {
        ctx.beginPath();
        ctx.arc(
          a.x * TILE + TILE / 2,
          a.y * TILE + TILE / 2,
          8 * pulse,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });

      // Player
      const px = s.player.x * TILE + TILE / 2;
      const py = s.player.y * TILE + TILE / 2;
      ctx.fillStyle = s.hidden ? "#555" : "#7dd3fc";
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillRect(px - 4, py - 2, 2, 2);
      ctx.fillRect(px + 2, py - 2, 2, 2);

      // Enemies
      s.enemies.forEach((enemy) => {
        const ex = enemy.pos.x * TILE + TILE / 2;
        const ey = enemy.pos.y * TILE + TILE / 2;
        ctx.save();
        ctx.translate(ex, ey);
        if (enemy.kind === "banana") {
          ctx.rotate(-0.4);
          ctx.fillStyle = "#f4d03f";
          ctx.beginPath();
          ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#1a1a1a";
          ctx.lineWidth = 1;
          for (let i = 0; i < 8; i++) {
            const hx = -8 + i * 2;
            ctx.beginPath();
            ctx.moveTo(hx, -6);
            ctx.lineTo(hx + 1, -11);
            ctx.stroke();
          }
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(2, -1, 2, 0, Math.PI * 2);
          ctx.arc(6, -1, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#c0392b";
          ctx.beginPath();
          ctx.arc(2, -1, 1, 0, Math.PI * 2);
          ctx.arc(6, -1, 1, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.kind === "apple") {
          // Killer apple: green w/ angry face
          ctx.fillStyle = "#7cb342";
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#3d2817";
          ctx.fillRect(-1, -12, 2, 4);
          // angry eyes
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-5, -3);
          ctx.lineTo(-1, -1);
          ctx.moveTo(5, -3);
          ctx.lineTo(1, -1);
          ctx.stroke();
          // jagged mouth
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.moveTo(-4, 4);
          ctx.lineTo(-2, 2);
          ctx.lineTo(0, 4);
          ctx.lineTo(2, 2);
          ctx.lineTo(4, 4);
          ctx.lineTo(2, 6);
          ctx.lineTo(0, 5);
          ctx.lineTo(-2, 6);
          ctx.closePath();
          ctx.fill();
        } else if (enemy.kind === "chicken") {
          // Crazy chicken: white body, red comb, jittering
          const jitter = (Math.random() - 0.5) * 1.5;
          ctx.translate(jitter, jitter);
          ctx.fillStyle = "#f5f5f5";
          ctx.beginPath();
          ctx.ellipse(0, 1, 10, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          // head
          ctx.beginPath();
          ctx.arc(6, -4, 5, 0, Math.PI * 2);
          ctx.fill();
          // red comb
          ctx.fillStyle = "#e74c3c";
          ctx.beginPath();
          ctx.arc(6, -8, 2, 0, Math.PI * 2);
          ctx.arc(8, -7, 1.5, 0, Math.PI * 2);
          ctx.fill();
          // beak
          ctx.fillStyle = "#f39c12";
          ctx.beginPath();
          ctx.moveTo(10, -3);
          ctx.lineTo(13, -2);
          ctx.lineTo(10, -1);
          ctx.closePath();
          ctx.fill();
          // crazy eye
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(7, -5, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(
            7 + Math.cos(now / 80) * 0.8,
            -5 + Math.sin(now / 80) * 0.8,
            1,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        } else if (enemy.kind === "fish") {
          // Fast fish: blue body, sharp teeth
          ctx.fillStyle = "#3498db";
          ctx.beginPath();
          ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          // tail
          ctx.beginPath();
          ctx.moveTo(-10, 0);
          ctx.lineTo(-15, -5);
          ctx.lineTo(-15, 5);
          ctx.closePath();
          ctx.fill();
          // eye
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(5, -1, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(5, -1, 1, 0, Math.PI * 2);
          ctx.fill();
          // teeth
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(8, 2);
          ctx.lineTo(9, 4);
          ctx.lineTo(10, 2);
          ctx.lineTo(11, 4);
          ctx.stroke();
        }
        ctx.restore();
      });

      // Vignette
      const grad = ctx.createRadialGradient(px, py, 30, px, py, 220);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.8)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, move, rerender]);

  const reset = () => {
    const d = getActiveDifficulty();
    stateRef.current = generateLevel(d.apples, d.enemies);
    enemySpeedRef.current = d.enemySpeedMs;
    rerender();
  };

  const backToMenu = () => {
    setStarted(false);
  };

  const s = stateRef.current;
  const activeDiff = getActiveDifficulty();

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start gap-3 p-3 bg-background text-foreground">
      <header className="text-center">
        <h1
          className="text-2xl md:text-4xl font-black tracking-wider"
          style={{
            color: "#f4d03f",
            textShadow:
              "2px 2px 0 #c0392b, 4px 4px 0 #1a1a1a",
            fontFamily: "'Courier New', monospace",
          }}
        >
          髪の生えたばなな追想曲
        </h1>
        <p className="text-xs mt-1 opacity-70">
          🍎 りんごを集めて脱出せよ 🍌
        </p>
      </header>

      {!started ? (
        <div
          className="flex flex-col gap-3 p-4 rounded-lg border-2 w-full max-w-md"
          style={{
            borderColor: "#5a2a2a",
            background: "rgba(0,0,0,0.4)",
          }}
        >
          <h2
            className="text-sm font-bold font-mono"
            style={{ color: "#f4d03f" }}
          >
            🎮 難易度を選択
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                onClick={() => setDifficultyId(d.id)}
                className="px-3 py-2 rounded text-xs font-bold font-mono transition-all"
                style={{
                  background:
                    difficultyId === d.id
                      ? "linear-gradient(135deg, #f4d03f, #c0392b)"
                      : "rgba(90,42,42,0.5)",
                  color: difficultyId === d.id ? "#1a0a0a" : "#f4d03f",
                  border:
                    difficultyId === d.id
                      ? "2px solid #f4d03f"
                      : "1px solid #5a2a2a",
                }}
              >
                {d.label}
                <div className="text-[9px] opacity-80 mt-0.5 font-normal">
                  {d.id === "custom" ? (
                    "自分で設定"
                  ) : (
                    <>
                      🍎{d.apples}・
                      {(Object.keys(d.enemies) as EnemyKind[])
                        .filter((k) => (d.enemies[k] ?? 0) > 0)
                        .map(
                          (k) =>
                            `${ENEMY_LABEL[k].split(" ")[0]}${d.enemies[k]}`,
                        )
                        .join(" ")}
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>

          {difficultyId === "custom" && (
            <div
              className="flex flex-col gap-2 p-3 rounded font-mono text-xs"
              style={{ background: "rgba(0,0,0,0.4)" }}
            >
              <div>
                <div className="flex justify-between">
                  <span>🍎 りんごの数</span>
                  <span style={{ color: "#f4d03f" }}>{customApples}個</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={customApples}
                  onChange={(e) => setCustomApples(parseInt(e.target.value))}
                  className="w-full accent-yellow-400"
                />
              </div>
              <div>
                <div className="flex justify-between">
                  <span>🍌 ばななの速さ</span>
                  <span style={{ color: "#f4d03f" }}>
                    {Math.round((2000 / customSpeed) * 10) / 10}歩/秒
                  </span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={800}
                  step={20}
                  // Inverted: higher slider = faster (lower ms)
                  value={880 - customSpeed}
                  onChange={(e) =>
                    setCustomSpeed(880 - parseInt(e.target.value))
                  }
                  className="w-full accent-yellow-400"
                />
                <div className="flex justify-between text-[9px] opacity-60">
                  <span>のろま</span>
                  <span>俊敏</span>
                </div>
              </div>

              <div className="border-t pt-2" style={{ borderColor: "#5a2a2a" }}>
                <div className="text-[10px] mb-1.5 opacity-80">
                  👹 敵の数（合計0でも開始可・無敵モード）
                </div>
                {(Object.keys(customEnemies) as EnemyKind[]).map((kind) => (
                  <div key={kind} className="mb-1">
                    <div className="flex justify-between text-[10px]">
                      <span>{ENEMY_LABEL[kind]}</span>
                      <span style={{ color: "#f4d03f" }}>
                        {customEnemies[kind]}体
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={6}
                      step={1}
                      value={customEnemies[kind]}
                      onChange={(e) =>
                        setCustomEnemies((prev) => ({
                          ...prev,
                          [kind]: parseInt(e.target.value),
                        }))
                      }
                      className="w-full accent-yellow-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={starting}
            className="px-6 py-3 text-lg font-bold rounded-lg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #f4d03f, #c0392b)",
              color: "#1a0a0a",
              boxShadow: "0 0 20px rgba(192,57,43,0.4)",
            }}
          >
            {starting ? "起動中..." : "▶ ゲーム開始"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-3 items-start w-full max-w-5xl">
          <div className="flex flex-col gap-2 flex-1 items-center">
            <div
              className="flex justify-between text-xs font-mono px-2 w-full"
              style={{ maxWidth: W }}
            >
              <span>🍎 {s.collected}/{s.totalApples}</span>
              <span style={{ color: "#f4d03f" }}>{activeDiff.label}</span>
              <span>{s.hidden ? "🫥 隠れ" : "🚶"}</span>
              <span>
                {s.status === "won"
                  ? "✨ クリア!"
                  : s.status === "lost"
                    ? "💀 ゲームオーバー"
                    : "⚠️"}
              </span>
            </div>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="rounded border-2 max-w-full h-auto"
              style={{
                borderColor: "#5a2a2a",
                imageRendering: "pixelated",
              }}
            />
            <div className="text-[10px] opacity-60 font-mono px-2 text-center">
              矢印 / WASD: 移動 ・ Shift: 隠れる
            </div>

            {/* Touch D-pad for mobile */}
            <div className="grid grid-cols-3 gap-1 lg:hidden select-none touch-none">
              <div />
              <button
                onPointerDown={() => move(0, -1)}
                className="w-12 h-12 rounded bg-yellow-400/20 border border-yellow-400/40 text-xl"
              >
                ↑
              </button>
              <div />
              <button
                onPointerDown={() => move(-1, 0)}
                className="w-12 h-12 rounded bg-yellow-400/20 border border-yellow-400/40 text-xl"
              >
                ←
              </button>
              <button
                onPointerDown={() => {
                  stateRef.current.hidden = !stateRef.current.hidden;
                  rerender();
                }}
                className="w-12 h-12 rounded bg-red-500/20 border border-red-500/40 text-xs"
              >
                {s.hidden ? "出る" : "隠れ"}
              </button>
              <button
                onPointerDown={() => move(1, 0)}
                className="w-12 h-12 rounded bg-yellow-400/20 border border-yellow-400/40 text-xl"
              >
                →
              </button>
              <div />
              <button
                onPointerDown={() => move(0, 1)}
                className="w-12 h-12 rounded bg-yellow-400/20 border border-yellow-400/40 text-xl"
              >
                ↓
              </button>
              <div />
            </div>

            <div className="flex gap-2">
              {s.status !== "playing" && (
                <button
                  onClick={reset}
                  className="px-4 py-2 rounded font-bold"
                  style={{ background: "#f4d03f", color: "#1a0a0a" }}
                >
                  ↻ もう一度
                </button>
              )}
              <button
                onClick={backToMenu}
                className="px-4 py-2 rounded font-bold text-xs"
                style={{
                  background: "rgba(90,42,42,0.6)",
                  color: "#f4d03f",
                  border: "1px solid #5a2a2a",
                }}
              >
                ← 難易度選択
              </button>
            </div>
          </div>

          {/* Mixer */}
          <div
            className="p-3 rounded-lg border-2 font-mono text-xs w-full lg:w-56"
            style={{
              borderColor: "#5a2a2a",
              background: "rgba(0,0,0,0.4)",
            }}
          >
            <h2 className="text-xs font-bold mb-2" style={{ color: "#f4d03f" }}>
              🎛 ミキサー
            </h2>
            {(
              [
                ["master", "マスター"],
                ["bgm", "BGM"],
                ["drone", "ドローン"],
                ["heart", "心拍"],
                ["sfx", "SFX"],
              ] as [keyof typeof mix, string][]
            ).map(([k, label]) => (
              <div key={k} className="mb-1.5">
                <div className="flex justify-between text-[10px]">
                  <span>{label}</span>
                  <span>{Math.round(mix[k] * 100)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={mix[k]}
                  onChange={(e) =>
                    setMix((m) => ({ ...m, [k]: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-yellow-400"
                />
              </div>
            ))}
            <button
              onClick={() => engineRef.current?.speak("テスト音声です。")}
              className="mt-1 w-full py-1 rounded text-[10px] font-bold"
              style={{ background: "#5a2a2a", color: "#f4d03f" }}
            >
              🔊 TTSテスト
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
