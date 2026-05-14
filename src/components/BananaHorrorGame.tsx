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
      this.started = true;
    }
  }

  startBGM() {
    if (!this.ctx || !this.bgmGain) return;
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

  playItem(kind: ItemKind) {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const presets: Record<ItemKind, number[]> = {
      heart: [523, 784, 1047],
      slow: [600, 400, 250],
      shield: [440, 660, 880, 660],
      stun: [1500, 200, 1500, 200],
    };
    presets[kind].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = kind === "stun" ? "square" : "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.001, t + i * 0.06);
      g.gain.linearRampToValueAtTime(0.22, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.3);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.35);
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
// Game
// ============================================================================

const TILE = 28;
const COLS = 20;
const ROWS = 14;
const W = TILE * COLS;
const H = TILE * ROWS;

type Vec = { x: number; y: number };

export type EnemyKind = "banana" | "apple" | "chicken" | "fish";
export type ItemKind = "heart" | "slow" | "shield" | "stun";

export interface Enemy {
  kind: EnemyKind;
  pos: Vec;
  lastMoveAt: number;
  nextTeleport?: number;
}

export interface Item {
  kind: ItemKind;
  pos: Vec;
}

const ENEMY_BASE_SPEED: Record<EnemyKind, number> = {
  banana: 1.0,
  apple: 1.6,
  chicken: 0.9,
  fish: 0.55,
};

const ENEMY_LABEL: Record<EnemyKind, string> = {
  banana: "👹 黄鬼",
  apple: "🍏 殺人りんご",
  chicken: "🐔 狂チキン",
  fish: "🐟 高速サカナ",
};

const ITEM_LABEL: Record<ItemKind, string> = {
  heart: "💚 ライフ",
  slow: "⏱️ 鈍化",
  shield: "🛡️ シールド",
  stun: "⚡ スタン",
};

const ITEM_EMOJI: Record<ItemKind, string> = {
  heart: "💚",
  slow: "⏱️",
  shield: "🛡️",
  stun: "⚡",
};

export interface Difficulty {
  id: string;
  label: string;
  apples: number;
  enemySpeedMs: number;
  enemies: Partial<Record<EnemyKind, number>>;
  items?: number; // total beneficial items spawned
}

// 10 finely-tuned difficulty levels + custom
export const DIFFICULTIES: Difficulty[] = [
  { id: "lv1",  label: "Lv1 ほのぼの 🍮",     apples: 3,  enemySpeedMs: 600, enemies: { banana: 1 },                                  items: 4 },
  { id: "lv2",  label: "Lv2 やさしい 🌱",     apples: 4,  enemySpeedMs: 520, enemies: { banana: 1 },                                  items: 4 },
  { id: "lv3",  label: "Lv3 おてがる 👹",     apples: 5,  enemySpeedMs: 440, enemies: { banana: 1, apple: 1 },                        items: 3 },
  { id: "lv4",  label: "Lv4 ふつう 😬",        apples: 6,  enemySpeedMs: 380, enemies: { banana: 1, apple: 1 },                        items: 3 },
  { id: "lv5",  label: "Lv5 ちょい難 🔥",     apples: 7,  enemySpeedMs: 320, enemies: { banana: 2, apple: 1 },                        items: 3 },
  { id: "lv6",  label: "Lv6 ハード 🔥🔥",     apples: 8,  enemySpeedMs: 270, enemies: { banana: 2, apple: 1, chicken: 1 },             items: 2 },
  { id: "lv7",  label: "Lv7 鬼ハード 👺",     apples: 10, enemySpeedMs: 230, enemies: { banana: 2, apple: 2, chicken: 1, fish: 1 },     items: 2 },
  { id: "lv8",  label: "Lv8 ナイトメア 💀",   apples: 12, enemySpeedMs: 190, enemies: { banana: 3, apple: 2, chicken: 2, fish: 1 },     items: 2 },
  { id: "lv9",  label: "Lv9 地獄 👹",          apples: 15, enemySpeedMs: 150, enemies: { banana: 3, apple: 3, chicken: 3, fish: 2 },     items: 1 },
  { id: "lv10", label: "Lv10 カオス 🌀",       apples: 20, enemySpeedMs: 110, enemies: { banana: 4, apple: 4, chicken: 4, fish: 3 },     items: 1 },
  { id: "custom", label: "カスタム ⚙️",         apples: 5,  enemySpeedMs: 320, enemies: { banana: 1 },                                   items: 3 },
];

interface GameState {
  player: Vec;
  enemies: Enemy[];
  apples: Vec[];
  items: Item[];
  walls: Set<string>;
  collected: number;
  status: "playing" | "won" | "lost";
  hidden: boolean;
  totalApples: number;
  // power-ups
  lives: number;
  shieldUntil: number;   // ms timestamp
  slowUntil: number;     // enemies move slower
  stunUntil: number;     // enemies frozen
  lastMessage: string;
}

function generateLevel(
  appleCount: number,
  enemyCounts: Partial<Record<EnemyKind, number>> | undefined,
  itemCount: number,
): GameState {
  const counts = enemyCounts ?? {};
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

  // Items: distribute roughly evenly among kinds
  const items: Item[] = [];
  const itemKinds: ItemKind[] = ["heart", "slow", "shield", "stun"];
  let iAttempts = 0;
  while (items.length < itemCount && iAttempts++ < 1500) {
    const c = freeCell();
    if (Math.abs(c.x - player.x) + Math.abs(c.y - player.y) < 3) continue;
    if (apples.some((a) => a.x === c.x && a.y === c.y)) continue;
    if (items.some((it) => it.pos.x === c.x && it.pos.y === c.y)) continue;
    const kind = itemKinds[items.length % itemKinds.length];
    items.push({ kind, pos: c });
  }

  const enemies: Enemy[] = [];
  (Object.keys(counts) as EnemyKind[]).forEach((kind) => {
    const n = counts[kind] ?? 0;
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
    items,
    walls,
    collected: 0,
    status: "playing",
    hidden: false,
    totalApples: apples.length,
    lives: 1,
    shieldUntil: 0,
    slowUntil: 0,
    stunUntil: 0,
    lastMessage: "",
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
  hidden: boolean,
): Vec {
  const k = enemy.kind;
  // When player is hidden, enemies can't see them — wander randomly.
  if (hidden) {
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "banana") {
    return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
  }
  if (k === "apple") {
    if (Math.random() < 0.3) {
      return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
    }
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "chicken") {
    if (Math.random() < 0.4) {
      return nextStepToward(enemy.pos, player, walls) ?? enemy.pos;
    }
    return randomFreeNeighbor(enemy.pos, walls) ?? enemy.pos;
  }
  if (k === "fish") {
    if (
      enemy.nextTeleport !== undefined &&
      now > enemy.nextTeleport &&
      Math.random() < 0.3
    ) {
      enemy.nextTeleport = now + 4000 + Math.random() * 3000;
      for (let i = 0; i < 30; i++) {
        const tx = player.x + Math.floor((Math.random() - 0.5) * 10);
        const ty = player.y + Math.floor((Math.random() - 0.5) * 10);
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

function TouchBtn({ onPress, label }: { onPress: () => void; label: string }) {
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onPress();
        stop();
        timer.current = window.setInterval(onPress, 150);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      className="w-16 h-16 rounded-lg border-2 text-2xl font-bold active:scale-95 touch-none"
      style={{ background: "rgba(244,208,63,0.18)", borderColor: "#f4d03f", color: "#f4d03f" }}
    >
      {label}
    </button>
  );
}

export function BananaHorrorGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const [difficultyId, setDifficultyId] = useState<string>("lv4");
  const [customApples, setCustomApples] = useState(5);
  const [customSpeed, setCustomSpeed] = useState(320);
  const [customItems, setCustomItems] = useState(3);
  const [customEnemies, setCustomEnemies] = useState<
    Record<EnemyKind, number>
  >({ banana: 1, apple: 0, chicken: 0, fish: 0 });

  const getActiveDifficulty = useCallback((): Difficulty => {
    const d = DIFFICULTIES.find((x) => x.id === difficultyId) ?? DIFFICULTIES[3];
    if (d.id === "custom") {
      return {
        ...d,
        apples: customApples,
        enemySpeedMs: customSpeed,
        enemies: customEnemies,
        items: customItems,
      };
    }
    return d;
  }, [difficultyId, customApples, customSpeed, customEnemies, customItems]);

  const stateRef = useRef<GameState>(generateLevel(5, { banana: 1 }, 3));
  const enemySpeedRef = useRef(320);
  const keysRef = useRef<Record<string, boolean>>({});
  const lastMoveRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((v) => v + 1), []);

  // Viewport tracking for responsive canvas sizing
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 800,
    h: typeof window !== "undefined" ? window.innerHeight : 600,
  }));
  useEffect(() => {
    const update = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  const isLandscape = viewport.w > viewport.h;
  const isTouch =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none)").matches;
  // D-pad always on the right on touch devices
  const reservedH = isLandscape ? 80 : 220;
  const reservedW = isTouch ? 220 : 24;
  const aspect = W / H;
  const maxByH = Math.max(180, viewport.h - reservedH);
  const maxByW = Math.max(220, viewport.w - reservedW);
  const cw = Math.min(W, maxByW, maxByH * aspect);
  const ch = cw / aspect;

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
      stateRef.current = generateLevel(d.apples, d.enemies, d.items ?? 3);
      enemySpeedRef.current = d.enemySpeedMs;
      if (!engineRef.current) engineRef.current = new AudioEngine();
      await engineRef.current.start();
      setStarted(true);
      const enemyTypes = (Object.keys(d.enemies ?? {}) as EnemyKind[])
        .filter((k) => (d.enemies?.[k] ?? 0) > 0)
        .map((k) => ENEMY_LABEL[k])
        .join("、");
      setTimeout(() => {
        engineRef.current?.speak(
          `${enemyTypes || "敵"}が、追いかけてくる。りんごを${d.apples}つ集めなさい。`,
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
      const key = e.key.toLowerCase();
      keysRef.current[key] = true;
      if (e.key === " " || e.key.startsWith("Arrow")) {
        e.preventDefault();
      }
      // Toggle hide on Shift press (edge-trigger, not hold)
      if (key === "shift") {
        const s = stateRef.current;
        if (s.status === "playing") {
          s.hidden = !s.hidden;
          s.lastMessage = s.hidden ? "🫥 隠れた（動けない）" : "🚶 出た";
          rerender();
        }
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
  }, [rerender]);

  // Player movement + pickups
  const move = useCallback((dx: number, dy: number) => {
    const s = stateRef.current;
    if (s.status !== "playing") return;
    if (s.hidden) return; // 隠れている間は動けない
    const nx = s.player.x + dx;
    const ny = s.player.y + dy;
    if (s.walls.has(`${nx},${ny}`)) return;
    s.player = { x: nx, y: ny };

    // Apple pickup
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
    }

    // Item pickup
    const iIdx = s.items.findIndex((it) => it.pos.x === nx && it.pos.y === ny);
    if (iIdx >= 0) {
      const item = s.items[iIdx];
      s.items.splice(iIdx, 1);
      const now = performance.now();
      engineRef.current?.playItem(item.kind);
      if (item.kind === "heart") {
        s.lives++;
        s.lastMessage = "💚 ライフ +1";
      } else if (item.kind === "slow") {
        s.slowUntil = now + 6000;
        s.lastMessage = "⏱️ 敵が6秒間鈍化";
      } else if (item.kind === "shield") {
        s.shieldUntil = now + 8000;
        s.lastMessage = "🛡️ 8秒間シールド";
      } else if (item.kind === "stun") {
        s.stunUntil = now + 3000;
        s.lastMessage = "⚡ 敵が3秒間停止";
      }
    }

    rerender();
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
      if (now - lastFrame < 33) {
        raf = requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;

      const s = stateRef.current;

      if (s.status === "playing") {
        // Player input
        if (now - lastMoveRef.current > 140 && !s.hidden) {
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
        }

        const stunned = now < s.stunUntil;
        const slowed = now < s.slowUntil;
        const shielded = now < s.shieldUntil;

        // Enemies
        if (!stunned) {
          const baseSpeed = enemySpeedRef.current;
          for (const enemy of s.enemies) {
            const kindMul = ENEMY_BASE_SPEED[enemy.kind];
            const speedMs =
              baseSpeed * kindMul * (slowed ? 1.8 : 1) * (s.hidden ? 1.5 : 1);
            if (now - enemy.lastMoveAt > speedMs) {
              const next = stepEnemy(enemy, s.player, s.walls, now, s.hidden);
              enemy.pos = next;
              enemy.lastMoveAt = now;
              if (enemy.pos.x === s.player.x && enemy.pos.y === s.player.y) {
                if (shielded) {
                  s.shieldUntil = 0;
                  s.lastMessage = "🛡️ シールドが砕けた！";
                  // bump enemy back to a neighbor
                  const back = randomFreeNeighbor(enemy.pos, s.walls);
                  if (back) enemy.pos = back;
                } else if (s.lives > 1) {
                  s.lives--;
                  s.shieldUntil = now + 1500; // brief invuln
                  s.lastMessage = `💔 ライフ -1（残${s.lives}）`;
                  const back = randomFreeNeighbor(enemy.pos, s.walls);
                  if (back) enemy.pos = back;
                } else {
                  s.status = "lost";
                  engineRef.current?.playGameOver();
                  engineRef.current?.speak(
                    `${ENEMY_LABEL[enemy.kind]}に、つかまった。`,
                  );
                  rerender();
                  break;
                }
                rerender();
              }
            }
          }
        }

        // Proximity audio
        let nearestDx = 99, nearestDist = 99;
        for (const enemy of s.enemies) {
          const dx = enemy.pos.x - s.player.x;
          const dy = enemy.pos.y - s.player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestDx = dx;
          }
        }
        const level = Math.max(0, 1 - nearestDist / 12);
        const pan = Math.max(-1, Math.min(1, nearestDx / 7));
        engineRef.current?.setProximity(level * (s.hidden ? 0.3 : 1), pan);
      }

      // ===== Render =====
      ctx.fillStyle = "#0a0805";
      ctx.fillRect(0, 0, W, H);

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
        ctx.arc(a.x * TILE + TILE / 2, a.y * TILE + TILE / 2, 8 * pulse, 0, Math.PI * 2);
        ctx.fill();
      });

      // Items (emoji)
      ctx.font = "18px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const ipulse = 1 + Math.sin(now / 200) * 0.15;
      s.items.forEach((it) => {
        const ix = it.pos.x * TILE + TILE / 2;
        const iy = it.pos.y * TILE + TILE / 2;
        // glow
        const g = ctx.createRadialGradient(ix, iy, 2, ix, iy, 16);
        g.addColorStop(0, "rgba(255,255,200,0.4)");
        g.addColorStop(1, "rgba(255,255,200,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ix, iy, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(ix, iy);
        ctx.scale(ipulse, ipulse);
        ctx.fillStyle = "#fff";
        ctx.fillText(ITEM_EMOJI[it.kind], 0, 0);
        ctx.restore();
      });

      // Player
      const px = s.player.x * TILE + TILE / 2;
      const py = s.player.y * TILE + TILE / 2;
      const shieldedNow = performance.now() < s.shieldUntil;
      if (shieldedNow) {
        ctx.strokeStyle = "rgba(120,200,255,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 13 + Math.sin(now / 100) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = s.hidden ? "#444" : "#7dd3fc";
      ctx.globalAlpha = s.hidden ? 0.45 : 1;
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!s.hidden) {
        ctx.fillStyle = "#000";
        ctx.fillRect(px - 4, py - 2, 2, 2);
        ctx.fillRect(px + 2, py - 2, 2, 2);
      }

      // Enemies
      const stunnedNow = performance.now() < s.stunUntil;
      s.enemies.forEach((enemy) => {
        const ex = enemy.pos.x * TILE + TILE / 2;
        const ey = enemy.pos.y * TILE + TILE / 2;
        ctx.save();
        ctx.translate(ex, ey);
        if (stunnedNow) ctx.globalAlpha = 0.55;
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
          ctx.fillStyle = "#7cb342";
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#3d2817";
          ctx.fillRect(-1, -12, 2, 4);
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-5, -3); ctx.lineTo(-1, -1);
          ctx.moveTo(5, -3); ctx.lineTo(1, -1);
          ctx.stroke();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.moveTo(-4, 4); ctx.lineTo(-2, 2); ctx.lineTo(0, 4);
          ctx.lineTo(2, 2); ctx.lineTo(4, 4); ctx.lineTo(2, 6);
          ctx.lineTo(0, 5); ctx.lineTo(-2, 6);
          ctx.closePath();
          ctx.fill();
        } else if (enemy.kind === "chicken") {
          const jitter = stunnedNow ? 0 : (Math.random() - 0.5) * 1.5;
          ctx.translate(jitter, jitter);
          ctx.fillStyle = "#f5f5f5";
          ctx.beginPath();
          ctx.ellipse(0, 1, 10, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(6, -4, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#e74c3c";
          ctx.beginPath();
          ctx.arc(6, -8, 2, 0, Math.PI * 2);
          ctx.arc(8, -7, 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#f39c12";
          ctx.beginPath();
          ctx.moveTo(10, -3); ctx.lineTo(13, -2); ctx.lineTo(10, -1);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(7, -5, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(7 + Math.cos(now / 80) * 0.8, -5 + Math.sin(now / 80) * 0.8, 1, 0, Math.PI * 2);
          ctx.fill();
        } else if (enemy.kind === "fish") {
          ctx.fillStyle = "#3498db";
          ctx.beginPath();
          ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-10, 0); ctx.lineTo(-15, -5); ctx.lineTo(-15, 5);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(5, -1, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(5, -1, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(8, 2); ctx.lineTo(9, 4); ctx.lineTo(10, 2); ctx.lineTo(11, 4);
          ctx.stroke();
        }
        // ⚡ stun marker
        if (stunnedNow) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#ffeb3b";
          ctx.font = "12px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("⚡", 0, -14);
        }
        ctx.restore();
      });

      // Vignette — darker when hidden
      const vignetteRadius = s.hidden ? 110 : 220;
      const grad = ctx.createRadialGradient(px, py, 30, px, py, vignetteRadius);
      grad.addColorStop(0, s.hidden ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0)");
      grad.addColorStop(1, s.hidden ? "rgba(0,0,0,0.95)" : "rgba(0,0,0,0.8)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, move, rerender]);

  const reset = () => {
    const d = getActiveDifficulty();
    stateRef.current = generateLevel(d.apples, d.enemies, d.items ?? 3);
    enemySpeedRef.current = d.enemySpeedMs;
    rerender();
  };

  const backToMenu = () => setStarted(false);

  const s = stateRef.current;
  const activeDiff = getActiveDifficulty();
  const nowMs = typeof performance !== "undefined" ? performance.now() : 0;
  const buffShield = Math.max(0, s.shieldUntil - nowMs);
  const buffSlow = Math.max(0, s.slowUntil - nowMs);
  const buffStun = Math.max(0, s.stunUntil - nowMs);

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-start gap-3 p-3 bg-background text-foreground">
      <header className="text-center">
        <h1
          className="text-2xl md:text-4xl font-black tracking-wider"
          style={{
            color: "#f4d03f",
            textShadow: "2px 2px 0 #c0392b, 4px 4px 0 #1a1a1a",
            fontFamily: "'Courier New', monospace",
          }}
        >
          黄鬼
        </h1>
        <p className="text-xs mt-1 opacity-70">
          🍎 りんごを集めて脱出せよ 🍌
        </p>
      </header>

      {!started ? (
        <div
          className="flex flex-col gap-3 p-4 rounded-lg border-2 w-full max-w-md"
          style={{ borderColor: "#5a2a2a", background: "rgba(0,0,0,0.4)" }}
        >
          <h2 className="text-sm font-bold font-mono" style={{ color: "#f4d03f" }}>
            🎮 難易度を選択（Lv1〜Lv10）
          </h2>
          <div className="grid grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto pr-1">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.id}
                onClick={() => setDifficultyId(d.id)}
                className="px-2 py-2 rounded text-[11px] font-bold font-mono transition-all text-left"
                style={{
                  background:
                    difficultyId === d.id
                      ? "linear-gradient(135deg, #f4d03f, #c0392b)"
                      : "rgba(90,42,42,0.5)",
                  color: difficultyId === d.id ? "#1a0a0a" : "#f4d03f",
                  border: difficultyId === d.id ? "2px solid #f4d03f" : "1px solid #5a2a2a",
                }}
              >
                {d.label}
                <div className="text-[9px] opacity-80 mt-0.5 font-normal">
                  {d.id === "custom" ? (
                    "自分で設定"
                  ) : (
                    <>
                      🍎{d.apples}・🎁{d.items ?? 0}・
                      {(Object.keys(d.enemies) as EnemyKind[])
                        .filter((k) => (d.enemies[k] ?? 0) > 0)
                        .map((k) => `${ENEMY_LABEL[k].split(" ")[0]}${d.enemies[k]}`)
                        .join(" ")}
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="text-[10px] opacity-70 font-mono p-2 rounded" style={{ background: "rgba(0,0,0,0.3)" }}>
            <div className="font-bold mb-0.5" style={{ color: "#f4d03f" }}>🎁 アイテム</div>
            💚 ライフ +1 ／ 🛡️ 8秒シールド ／ ⏱️ 敵を6秒鈍化 ／ ⚡ 敵を3秒停止
          </div>

          {difficultyId === "custom" && (
            <div className="flex flex-col gap-2 p-3 rounded font-mono text-xs" style={{ background: "rgba(0,0,0,0.4)" }}>
              <div>
                <div className="flex justify-between">
                  <span>🍎 りんごの数</span>
                  <span style={{ color: "#f4d03f" }}>{customApples}個</span>
                </div>
                <input type="range" min={1} max={20} step={1} value={customApples}
                  onChange={(e) => setCustomApples(parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
              </div>
              <div>
                <div className="flex justify-between">
                  <span>🎁 アイテム数</span>
                  <span style={{ color: "#f4d03f" }}>{customItems}個</span>
                </div>
                <input type="range" min={0} max={10} step={1} value={customItems}
                  onChange={(e) => setCustomItems(parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
              </div>
              <div>
                <div className="flex justify-between">
                  <span>👹 黄鬼の速さ</span>
                  <span style={{ color: "#f4d03f" }}>
                    {Math.round((2000 / customSpeed) * 10) / 10}歩/秒
                  </span>
                </div>
                <input type="range" min={80} max={800} step={20}
                  value={880 - customSpeed}
                  onChange={(e) => setCustomSpeed(880 - parseInt(e.target.value))}
                  className="w-full accent-yellow-400" />
                <div className="flex justify-between text-[9px] opacity-60">
                  <span>のろま</span><span>俊敏</span>
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
                      <span style={{ color: "#f4d03f" }}>{customEnemies[kind]}体</span>
                    </div>
                    <input type="range" min={0} max={6} step={1} value={customEnemies[kind]}
                      onChange={(e) => setCustomEnemies((prev) => ({
                        ...prev, [kind]: parseInt(e.target.value),
                      }))}
                      className="w-full accent-yellow-400" />
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
          <div className="flex flex-col gap-2 flex-1 items-center w-full">
            <div className="flex flex-wrap justify-between gap-1 text-xs font-mono px-2 w-full" style={{ maxWidth: cw }}>
              <span>🍎 {s.collected}/{s.totalApples}</span>
              <span>💚 {s.lives}</span>
              <span style={{ color: "#f4d03f" }}>{activeDiff.label}</span>
              <span>{s.hidden ? "🫥 隠れ中" : "🚶 行動中"}</span>
              <span>
                {s.status === "won" ? "✨ クリア!" :
                 s.status === "lost" ? "💀 ゲームオーバー" : "⚠️"}
              </span>
            </div>
            {/* Active buffs */}
            <div className="flex gap-2 text-[10px] font-mono px-2 w-full" style={{ maxWidth: cw }}>
              {buffShield > 0 && <span className="text-cyan-300">🛡️ {(buffShield/1000).toFixed(1)}s</span>}
              {buffSlow > 0 && <span className="text-blue-300">⏱️ {(buffSlow/1000).toFixed(1)}s</span>}
              {buffStun > 0 && <span className="text-yellow-300">⚡ {(buffStun/1000).toFixed(1)}s</span>}
              {s.lastMessage && <span className="opacity-70 ml-auto">{s.lastMessage}</span>}
            </div>

            {/* Canvas + landscape D-pad row */}
            <div className="flex flex-row gap-3 items-center justify-center w-full">
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  touchStartRef.current = { x: t.clientX, y: t.clientY };
                }}
                onTouchEnd={(e) => {
                  const start = touchStartRef.current;
                  if (!start) return;
                  const t = e.changedTouches[0];
                  const dx = t.clientX - start.x;
                  const dy = t.clientY - start.y;
                  const ax = Math.abs(dx), ay = Math.abs(dy);
                  if (Math.max(ax, ay) < 20) {
                    const st = stateRef.current;
                    if (st.status === "playing") {
                      st.hidden = !st.hidden;
                      st.lastMessage = st.hidden ? "🫥 隠れた" : "🚶 出た";
                      rerender();
                    }
                  } else if (ax > ay) {
                    move(dx > 0 ? 1 : -1, 0);
                  } else {
                    move(0, dy > 0 ? 1 : -1);
                  }
                  touchStartRef.current = null;
                }}
                className="rounded border-2 touch-none block"
                style={{
                  borderColor: "#5a2a2a",
                  imageRendering: "pixelated",
                  width: cw,
                  height: ch,
                }}
              />

              {/* Touch D-pad */}
              <div className="grid grid-cols-3 gap-2 select-none touch-none [@media(hover:hover)]:hidden">
                <div />
                <TouchBtn onPress={() => move(0, -1)} label="↑" />
                <div />
                <TouchBtn onPress={() => move(-1, 0)} label="←" />
                <button
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const st = stateRef.current;
                    if (st.status !== "playing") return;
                    st.hidden = !st.hidden;
                    st.lastMessage = st.hidden ? "🫥 隠れた" : "🚶 出た";
                    rerender();
                  }}
                  className="w-16 h-16 rounded-lg border-2 text-xs font-bold active:scale-95 touch-none"
                  style={{ background: "rgba(192,57,43,0.25)", borderColor: "#c0392b", color: "#f4d03f" }}
                >
                  {s.hidden ? "出る" : "隠れ"}
                </button>
                <TouchBtn onPress={() => move(1, 0)} label="→" />
                <div />
                <TouchBtn onPress={() => move(0, 1)} label="↓" />
                <div />
              </div>
            </div>

            <div className="text-[10px] opacity-60 font-mono px-2 text-center">
              矢印/WASD・Shift：隠れる ／ スマホ：スワイプで移動・タップで隠れる
            </div>

            <div className="flex gap-2">
              {s.status !== "playing" && (
                <button onClick={reset} className="px-4 py-2 rounded font-bold"
                  style={{ background: "#f4d03f", color: "#1a0a0a" }}>
                  ↻ もう一度
                </button>
              )}
              <button onClick={backToMenu} className="px-4 py-2 rounded font-bold text-xs"
                style={{ background: "rgba(90,42,42,0.6)", color: "#f4d03f", border: "1px solid #5a2a2a" }}>
                ← 難易度選択
              </button>
            </div>
          </div>

          <details className="rounded-lg border-2 font-mono text-xs w-full lg:w-56"
            style={{ borderColor: "#5a2a2a", background: "rgba(0,0,0,0.4)" }}>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold flex items-center justify-between"
              style={{ color: "#f4d03f" }}>
              <span>🎛 ミキサー</span>
              <span className="text-[10px] opacity-70">クリックで開閉</span>
            </summary>
            <div className="p-3 pt-0">
              {([
                ["master", "マスター"],
                ["bgm", "BGM"],
                ["drone", "ドローン"],
                ["heart", "心拍"],
                ["sfx", "SFX"],
              ] as [keyof typeof mix, string][]).map(([k, label]) => (
                <div key={k} className="mb-1.5">
                  <div className="flex justify-between text-[10px]">
                    <span>{label}</span>
                    <span>{Math.round(mix[k] * 100)}</span>
                  </div>
                  <input type="range" min={0} max={1} step={0.01} value={mix[k]}
                    onChange={(e) => setMix((m) => ({ ...m, [k]: parseFloat(e.target.value) }))}
                    className="w-full accent-yellow-400" />
                </div>
              ))}
              <div className="mt-2 pt-2 border-t text-[10px] leading-relaxed" style={{ borderColor: "#5a2a2a" }}>
                <div className="font-bold mb-1" style={{ color: "#f4d03f" }}>🎁 アイテム</div>
                {(Object.keys(ITEM_LABEL) as ItemKind[]).map((k) => (
                  <div key={k}>{ITEM_LABEL[k]}</div>
                ))}
              </div>
              <button
                onClick={() => engineRef.current?.speak("テスト音声です。")}
                className="mt-2 w-full py-1 rounded text-[10px] font-bold"
                style={{ background: "#5a2a2a", color: "#f4d03f" }}>
                🔊 TTSテスト
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
