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

interface GameState {
  player: Vec;
  enemy: Vec;
  apples: Vec[];
  walls: Set<string>;
  collected: number;
  status: "playing" | "won" | "lost";
  hidden: boolean;
}

function generateLevel(): GameState {
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
    for (let i = 0; i < 200; i++) {
      const x = 1 + Math.floor(Math.random() * (COLS - 2));
      const y = 1 + Math.floor(Math.random() * (ROWS - 2));
      if (!walls.has(`${x},${y}`)) return { x, y };
    }
    return { x: 1, y: 1 };
  };

  const player = { x: 2, y: 2 };
  walls.delete("2,2");
  walls.delete("2,3");
  walls.delete("3,2");

  const apples: Vec[] = [];
  while (apples.length < 5) {
    const c = freeCell();
    if (Math.abs(c.x - player.x) + Math.abs(c.y - player.y) < 5) continue;
    if (apples.some((a) => a.x === c.x && a.y === c.y)) continue;
    apples.push(c);
  }

  let enemy = freeCell();
  for (let i = 0; i < 50; i++) {
    if (Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y) >= 8) break;
    enemy = freeCell();
  }

  return {
    player,
    enemy,
    apples,
    walls,
    collected: 0,
    status: "playing",
    hidden: false,
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

export function BananaHorrorGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const stateRef = useRef<GameState>(generateLevel());
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
      if (!engineRef.current) engineRef.current = new AudioEngine();
      await engineRef.current.start();
      setStarted(true);
      // Defer speech to avoid blocking
      setTimeout(() => {
        engineRef.current?.speak("バナナが、追いかけてくる。りんごを5つ集めなさい。");
      }, 300);
    } catch (e) {
      console.error("start failed", e);
      setStarted(true); // start game anyway
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
      if (s.collected >= 5) {
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

        // Enemy
        const speedMs = s.hidden ? 700 : 320;
        if (now - lastEnemyRef.current > speedMs) {
          const step = nextStepToward(s.enemy, s.player, s.walls);
          if (step) s.enemy = step;
          lastEnemyRef.current = now;
          if (s.enemy.x === s.player.x && s.enemy.y === s.player.y) {
            s.status = "lost";
            engineRef.current?.playGameOver();
            engineRef.current?.speak("つかまえた。");
            rerender();
          }
        }

        // Proximity audio
        const dx = s.enemy.x - s.player.x;
        const dy = s.enemy.y - s.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const level = Math.max(0, 1 - dist / 12);
        const pan = Math.max(-1, Math.min(1, dx / 7));
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

      // Enemy: hairy banana (simplified)
      const ex = s.enemy.x * TILE + TILE / 2;
      const ey = s.enemy.y * TILE + TILE / 2;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-0.4);
      ctx.fillStyle = "#f4d03f";
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // hair (fewer strands)
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
      ctx.restore();

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
    stateRef.current = generateLevel();
    rerender();
  };

  const s = stateRef.current;

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
          🍎 りんごを5つ集めて脱出せよ 🍌
        </p>
      </header>

      {!started ? (
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
          {starting ? "起動中..." : "▶ ゲーム開始（タップで音声有効化）"}
        </button>
      ) : (
        <div className="flex flex-col lg:flex-row gap-3 items-start w-full max-w-5xl">
          <div className="flex flex-col gap-2 flex-1 items-center">
            <div
              className="flex justify-between text-xs font-mono px-2 w-full"
              style={{ maxWidth: W }}
            >
              <span>🍎 {s.collected}/5</span>
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

            {s.status !== "playing" && (
              <button
                onClick={reset}
                className="px-4 py-2 rounded font-bold"
                style={{ background: "#f4d03f", color: "#1a0a0a" }}
              >
                ↻ もう一度
              </button>
            )}
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
