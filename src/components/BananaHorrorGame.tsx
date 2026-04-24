import { useEffect, useRef, useState, useCallback } from "react";

// ============================================================================
// Audio Engine - WebAudio synthesis only
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
  proximitySource: AudioBufferSourceNode | null = null;
  reverb: ConvolverNode | null = null;
  reverbGain: GainNode | null = null;
  bgmNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  droneOsc: OscillatorNode | null = null;
  heartTimer: number | null = null;
  heartRate = 60;
  started = false;

  async start() {
    if (this.started) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);

    // Reverb
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulseResponse(2.5, 3);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.25;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    // Bus gains
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.18;
    this.bgmGain.connect(this.master);
    this.bgmGain.connect(this.reverb);

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0.12;
    this.droneGain.connect(this.master);
    this.droneGain.connect(this.reverb);

    this.heartGain = this.ctx.createGain();
    this.heartGain.gain.value = 0.6;
    this.heartGain.connect(this.master);

    this.proximityGain = this.ctx.createGain();
    this.proximityGain.gain.value = 0;
    this.proximityPanner = this.ctx.createStereoPanner();
    this.proximityFilter = this.ctx.createBiquadFilter();
    this.proximityFilter.type = "lowpass";
    this.proximityFilter.frequency.value = 800;
    this.proximityGain
      .connect(this.proximityFilter)
      .connect(this.proximityPanner)
      .connect(this.master);
    this.proximityPanner.connect(this.reverb);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.master);
    this.sfxGain.connect(this.reverb);

    this.startBGM();
    this.startDrone();
    this.startProximity();
    this.scheduleHeartbeat();
    this.started = true;
  }

  makeImpulseResponse(duration: number, decay: number) {
    if (!this.ctx) throw new Error("no ctx");
    const rate = this.ctx.sampleRate;
    const length = rate * duration;
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  startBGM() {
    if (!this.ctx || !this.bgmGain) return;
    // Eerie minor chord drone with detune
    const freqs = [110, 130.81, 164.81, 196]; // A2, C3, E3, G3
    freqs.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 8;
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(
        0.25,
        this.ctx!.currentTime + 2 + i * 0.5,
      );
      // LFO for tremolo
      const lfo = this.ctx!.createOscillator();
      const lfoGain = this.ctx!.createGain();
      lfo.frequency.value = 0.15 + i * 0.07;
      lfoGain.gain.value = 0.08;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();
      osc.connect(g).connect(this.bgmGain!);
      osc.start();
      this.bgmNodes.push({ osc, gain: g });
    });
  }

  startDrone() {
    if (!this.ctx || !this.droneGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    osc.connect(filter).connect(this.droneGain);
    osc.start();
    this.droneOsc = osc;
  }

  startProximity() {
    if (!this.ctx || !this.proximityGain) return;
    // Pink-ish noise loop buffer
    const dur = 2;
    const buf = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate * dur,
      this.ctx.sampleRate,
    );
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.proximityGain);
    src.start();
    this.proximitySource = src;
  }

  setProximity(level: number, pan: number) {
    if (!this.ctx || !this.proximityGain || !this.proximityPanner || !this.proximityFilter)
      return;
    const t = this.ctx.currentTime;
    this.proximityGain.gain.linearRampToValueAtTime(
      Math.min(0.5, level * 0.5),
      t + 0.1,
    );
    this.proximityPanner.pan.linearRampToValueAtTime(pan, t + 0.1);
    this.proximityFilter.frequency.linearRampToValueAtTime(
      400 + level * 2200,
      t + 0.1,
    );
    // heartrate scales with proximity
    this.heartRate = 60 + level * 100;
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
      g.gain.setValueAtTime(0, t + offset);
      g.gain.linearRampToValueAtTime(vol, t + offset + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.15);
      osc.connect(g).connect(this.heartGain!);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    };
    beat(0, 0.6);
    beat(0.18, 0.45);
  }

  playPickup() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, t + i * 0.07);
      g.gain.setValueAtTime(0, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.3, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.4);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.5);
    });
  }

  playGameOver() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 1.5);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 1.6);
  }

  playWin() {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.15);
      g.gain.linearRampToValueAtTime(0.3, t + i * 0.15 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.6);
      osc.connect(g).connect(this.sfxGain!);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.7);
    });
  }

  speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 0.85;
    u.pitch = 0.6;
    u.volume = 0.9;
    window.speechSynthesis.speak(u);
  }

  setMix(name: "master" | "bgm" | "drone" | "heart" | "sfx" | "reverb", v: number) {
    const map: Record<string, GainNode | null> = {
      master: this.master,
      bgm: this.bgmGain,
      drone: this.droneGain,
      heart: this.heartGain,
      sfx: this.sfxGain,
      reverb: this.reverbGain,
    };
    const node = map[name];
    if (node && this.ctx) {
      node.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.05);
    }
  }
}

// ============================================================================
// Game
// ============================================================================

const TILE = 32;
const COLS = 24;
const ROWS = 16;
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
  // Border
  for (let x = 0; x < COLS; x++) {
    walls.add(`${x},0`);
    walls.add(`${x},${ROWS - 1}`);
  }
  for (let y = 0; y < ROWS; y++) {
    walls.add(`0,${y}`);
    walls.add(`${COLS - 1},${y}`);
  }
  // Random interior walls (pillars/blocks)
  const rng = () => Math.random();
  for (let i = 0; i < 45; i++) {
    const x = 2 + Math.floor(rng() * (COLS - 4));
    const y = 2 + Math.floor(rng() * (ROWS - 4));
    walls.add(`${x},${y}`);
    if (rng() > 0.5) walls.add(`${x + 1},${y}`);
    if (rng() > 0.7) walls.add(`${x},${y + 1}`);
  }

  const freeCell = (): Vec => {
    while (true) {
      const x = 1 + Math.floor(Math.random() * (COLS - 2));
      const y = 1 + Math.floor(Math.random() * (ROWS - 2));
      if (!walls.has(`${x},${y}`)) return { x, y };
    }
  };

  // Carve player area
  const player = { x: 2, y: 2 };
  walls.delete("2,2");
  walls.delete("2,3");
  walls.delete("3,2");

  const apples: Vec[] = [];
  while (apples.length < 5) {
    const c = freeCell();
    if (Math.abs(c.x - player.x) + Math.abs(c.y - player.y) < 6) continue;
    if (apples.some((a) => a.x === c.x && a.y === c.y)) continue;
    apples.push(c);
  }

  let enemy = freeCell();
  while (Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y) < 10) {
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
  while (queue.length && iter++ < 600) {
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
  const engineRef = useRef<AudioEngine>(new AudioEngine());
  const stateRef = useRef<GameState>(generateLevel());
  const keysRef = useRef<Record<string, boolean>>({});
  const lastMoveRef = useRef(0);
  const lastEnemyRef = useRef(0);
  const enemyShakeRef = useRef(0);

  const [started, setStarted] = useState(false);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((v) => v + 1), []);

  const [mix, setMix] = useState({
    master: 0.8,
    bgm: 0.18,
    drone: 0.12,
    heart: 0.6,
    sfx: 0.5,
    reverb: 0.25,
  });

  // Start
  const handleStart = async () => {
    await engineRef.current.start();
    setStarted(true);
    engineRef.current.speak("バナナが、追いかけてくる。りんごを、5つ、集めなさい。");
  };

  // Mixer
  useEffect(() => {
    if (!started) return;
    (Object.keys(mix) as (keyof typeof mix)[]).forEach((k) => {
      engineRef.current.setMix(k, mix[k]);
    });
  }, [mix, started]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      if (e.key === " ") e.preventDefault();
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

  // Game loop
  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const tick = (now: number) => {
      const s = stateRef.current;

      if (s.status === "playing") {
        // Player movement (grid-based, throttled)
        if (now - lastMoveRef.current > 130) {
          let dx = 0,
            dy = 0;
          const k = keysRef.current;
          if (k["arrowup"] || k["w"]) dy = -1;
          else if (k["arrowdown"] || k["s"]) dy = 1;
          else if (k["arrowleft"] || k["a"]) dx = -1;
          else if (k["arrowright"] || k["d"]) dx = 1;
          if (dx || dy) {
            const nx = s.player.x + dx;
            const ny = s.player.y + dy;
            if (!s.walls.has(`${nx},${ny}`)) {
              s.player = { x: nx, y: ny };
              lastMoveRef.current = now;
              // pickup
              const idx = s.apples.findIndex(
                (a) => a.x === nx && a.y === ny,
              );
              if (idx >= 0) {
                s.apples.splice(idx, 1);
                s.collected++;
                engineRef.current.playPickup();
                if (s.collected >= 5) {
                  s.status = "won";
                  engineRef.current.playWin();
                  engineRef.current.speak("脱出、成功。おめでとう。");
                } else {
                  engineRef.current.speak(
                    `りんご、${s.collected}個目`,
                  );
                }
                rerender();
              }
            }
          }
          // hide
          s.hidden = !!k["shift"];
        }

        // Enemy movement
        const speedMs = s.hidden ? 600 : 280;
        if (now - lastEnemyRef.current > speedMs) {
          const step = nextStepToward(s.enemy, s.player, s.walls);
          if (step) s.enemy = step;
          lastEnemyRef.current = now;
          enemyShakeRef.current = 1;
          if (s.enemy.x === s.player.x && s.enemy.y === s.player.y) {
            s.status = "lost";
            engineRef.current.playGameOver();
            engineRef.current.speak("つかまえた。");
            rerender();
          }
        }

        // Proximity audio
        const dx = s.enemy.x - s.player.x;
        const dy = s.enemy.y - s.player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 14;
        const level = Math.max(0, 1 - dist / maxDist);
        const pan = Math.max(-1, Math.min(1, dx / 8));
        engineRef.current.setProximity(level * (s.hidden ? 0.4 : 1), pan);
      }

      // Render
      enemyShakeRef.current *= 0.9;
      const shake = enemyShakeRef.current * 2;

      // Vignette dark bg
      ctx.fillStyle = "#0a0805";
      ctx.fillRect(0, 0, W, H);

      // Floor tiles
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (s.walls.has(`${x},${y}`)) continue;
          ctx.fillStyle = (x + y) % 2 === 0 ? "#1a1410" : "#221a14";
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }

      // Walls (creepy bricks)
      s.walls.forEach((k) => {
        const [x, y] = k.split(",").map(Number);
        ctx.fillStyle = "#3a1a1a";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.strokeStyle = "#5a2a2a";
        ctx.lineWidth = 1;
        ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
      });

      // Apples
      s.apples.forEach((a) => {
        const cx = a.x * TILE + TILE / 2;
        const cy = a.y * TILE + TILE / 2;
        const pulse = 1 + Math.sin(now / 200 + a.x) * 0.15;
        ctx.fillStyle = "#e63946";
        ctx.beginPath();
        ctx.arc(cx, cy, 9 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2d6a3e";
        ctx.fillRect(cx - 1, cy - 11, 2, 4);
      });

      // Player (kid)
      const px = s.player.x * TILE + TILE / 2;
      const py = s.player.y * TILE + TILE / 2;
      ctx.fillStyle = s.hidden ? "#444" : "#7dd3fc";
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.fillRect(px - 4, py - 2, 2, 2);
      ctx.fillRect(px + 2, py - 2, 2, 2);

      // Enemy: hairy banana
      const ex = s.enemy.x * TILE + TILE / 2 + (Math.random() - 0.5) * shake;
      const ey = s.enemy.y * TILE + TILE / 2 + (Math.random() - 0.5) * shake;
      // banana body
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(-0.4);
      ctx.fillStyle = "#f4d03f";
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7a5a1a";
      ctx.fillRect(-13, -1, 3, 2);
      // hair
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const hx = -10 + i * 1.5;
        const hy = -7 + Math.sin(now / 100 + i) * 1;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + (Math.random() - 0.5) * 3, hy - 6 - Math.random() * 4);
        ctx.stroke();
      }
      // eyes
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(2, -1, 2.5, 0, Math.PI * 2);
      ctx.arc(7, -1, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c0392b";
      ctx.beginPath();
      ctx.arc(2, -1, 1.2, 0, Math.PI * 2);
      ctx.arc(7, -1, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Vignette overlay (darker when far)
      const grad = ctx.createRadialGradient(px, py, 40, px, py, 280);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.85)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, rerender]);

  const reset = () => {
    stateRef.current = generateLevel();
    rerender();
  };

  const s = stateRef.current;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-4 p-4 bg-background text-foreground">
      <header className="text-center">
        <h1
          className="text-3xl md:text-5xl font-black tracking-wider"
          style={{
            color: "#f4d03f",
            textShadow:
              "2px 2px 0 #c0392b, 4px 4px 0 #1a1a1a, 0 0 20px rgba(244,208,63,0.4)",
            fontFamily: "'Courier New', monospace",
          }}
        >
          髪の生えたばなな追想曲
        </h1>
        <p className="text-sm mt-1 opacity-70">
          🍎 りんごを5つ集めて脱出せよ 🍌
        </p>
      </header>

      {!started ? (
        <button
          onClick={handleStart}
          className="px-8 py-4 text-xl font-bold rounded-lg transition-transform hover:scale-105"
          style={{
            background: "linear-gradient(135deg, #f4d03f, #c0392b)",
            color: "#1a0a0a",
            boxShadow: "0 0 30px rgba(192,57,43,0.5)",
          }}
        >
          ▶ ゲーム開始（音声を有効化）
        </button>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex flex-col gap-2">
            <div
              className="flex justify-between text-sm font-mono px-2"
              style={{ width: W }}
            >
              <span>
                🍎 {s.collected} / 5
              </span>
              <span>{s.hidden ? "🫥 隠れ中" : "🚶 移動中"}</span>
              <span>
                {s.status === "won"
                  ? "✨ クリア!"
                  : s.status === "lost"
                    ? "💀 ゲームオーバー"
                    : "⚠️ 逃走中"}
              </span>
            </div>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="rounded border-2"
              style={{
                borderColor: "#5a2a2a",
                imageRendering: "pixelated",
                maxWidth: "100%",
              }}
            />
            <div className="text-xs opacity-60 font-mono px-2">
              矢印キー / WASD: 移動 ・ Shift押しっぱなし: 隠れる(敵が遅くなる)
            </div>
            {s.status !== "playing" && (
              <button
                onClick={reset}
                className="self-start px-4 py-2 rounded font-bold"
                style={{
                  background: "#f4d03f",
                  color: "#1a0a0a",
                }}
              >
                ↻ もう一度
              </button>
            )}
          </div>

          {/* Mixer */}
          <div
            className="p-4 rounded-lg border-2 font-mono text-xs w-full lg:w-64"
            style={{
              borderColor: "#5a2a2a",
              background: "rgba(0,0,0,0.4)",
            }}
          >
            <h2 className="text-sm font-bold mb-3" style={{ color: "#f4d03f" }}>
              🎛 ミキサー
            </h2>
            {(
              [
                ["master", "マスター"],
                ["bgm", "BGM"],
                ["drone", "ドローン"],
                ["heart", "心拍"],
                ["sfx", "SFX"],
                ["reverb", "リバーブ"],
              ] as [keyof typeof mix, string][]
            ).map(([k, label]) => (
              <div key={k} className="mb-2">
                <div className="flex justify-between">
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
              onClick={() =>
                engineRef.current.speak("これは、テスト音声です。")
              }
              className="mt-2 w-full py-1.5 rounded text-xs font-bold"
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
