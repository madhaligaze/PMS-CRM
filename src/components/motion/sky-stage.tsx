import { useEffect, useRef, useState } from 'react';
import { currentTheme, onThemeChange, type Theme } from '@/components/theme/theme-store';
import { prefersReducedMotion } from './gsap';

/**
 * Небо входа: днём - голубое, переменная облачность; ночью облака рассеиваются,
 * небо уходит в закат. Облака живые: плывут по ветру медленнее у горизонта,
 * чем над головой, и понемногу меняют форму.
 *
 * Как держится скорость на слабом железе
 * ─────────────────────────────────────
 * * Шум не считается в шейдере, а берётся из текстуры 256×256: одна выборка
 *   вместо четырёх хешей на каждую октаву.
 * * Полотно рисуется в уменьшенном разрешении и растягивается браузером:
 *   облака мягкие, лишние пиксели им не нужны.
 * * Уровень качества (разрешение, октавы, слои, искажение, свет) выбирается по
 *   железу, а потом проверяется по факту: первые кадры идут без ограничения, и
 *   если средний кадр дольше 24 мс, уровень снижается. Выбор запоминается на
 *   устройстве. Программный рендер (SwiftShader, llvmpipe) - один неподвижный кадр.
 * * Чистое небо считается дёшево: где облака нет, освещение не вычисляется.
 * * 30 кадров в секунду, во время смены темы - 60; во скрытой вкладке - ноль.
 *
 * Полотно после смены размера рисуется сразу, в том же обработчике: смена
 * canvas.width стирает буфер, и пустой кадр мигнул бы.
 */

type Tier = 0 | 1 | 2 | 3;
/**
 * Уровни качества: разрешение полотна (доля CSS-пикселя), октавы формы и
 * светотени, гребни в светотени. Ниже уровень - мягче края и меньше фактуры,
 * но облака остаются облаками.
 */
const TIERS: Record<Tier, { scale: number; shape: number; light: number; ridge: 0 | 1 }> = {
  3: { scale: 0.62, shape: 7, light: 6, ridge: 1 },
  2: { scale: 0.5, shape: 6, light: 5, ridge: 1 },
  1: { scale: 0.4, shape: 5, light: 4, ridge: 0 },
  0: { scale: 0.34, shape: 4, light: 3, ridge: 0 },
};
const TIER_KEY = 'ba.sky';
/** Облачность днём: переменная, небо видно между облаками. */
const DAY_COVER = 0.56;
/** С какого мгновения «погоды» начинается небо: облака по краям, середина ясная. */
const SKY_EPOCH_S = 150;

const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';

/**
 * Облака - двумерный приём: форма из обычного и «гребенчатого» шума (гребни
 * дают рваные кучевые края), светотень - отдельным шумом помельче. Каждая
 * октава сдвигается по-своему, поэтому облака не просто плывут, а меняют форму.
 */
function fragment(t: (typeof TIERS)[Tier]): string {
  return `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define SHAPE_OCT ${t.shape}
#define LIGHT_OCT ${t.light}
#define RIDGE ${t.ridge}

uniform vec2 u_res;
uniform float u_time;
uniform float u_night;
uniform float u_cover;
uniform sampler2D u_noise;

// Знаковый шум из текстуры: одна выборка вместо хешей.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(u_noise, (i + f + 0.5) / 256.0).x * 2.0 - 1.0;
}

const mat2 M = mat2(1.6, 1.2, -1.2, 1.6);

float warp(vec2 n) {
  float total = 0.0;
  float amp = 0.1;
  for (int i = 0; i < SHAPE_OCT - 1; i++) {
    total += noise(n) * amp;
    n = M * n;
    amp *= 0.4;
  }
  return total;
}

vec3 skyDay(vec2 uv) {
  vec3 c = mix(vec3(0.62, 0.81, 0.96), vec3(0.16, 0.44, 0.84), smoothstep(-0.05, 1.05, uv.y));
  float g = exp(-length((uv - vec2(0.12, 1.12)) * vec2(1.0, 1.35)) * 2.4);
  return c + vec3(0.32, 0.30, 0.22) * g * 0.5;
}

// Закат: персик у горизонта, розовый выше, пыльная роза над головой.
vec3 skyDusk(vec2 uv) {
  vec3 low = vec3(1.0, 0.76, 0.48);
  vec3 mid = vec3(0.97, 0.58, 0.55);
  vec3 top = vec3(0.80, 0.46, 0.60);
  vec3 c = mix(low, mid, smoothstep(-0.02, 0.48, uv.y));
  c = mix(c, top, smoothstep(0.48, 1.1, uv.y));
  float g = exp(-length((uv - vec2(0.64, -0.1)) * vec2(0.85, 1.5)) * 2.1);
  return c + vec3(0.36, 0.22, 0.08) * g;
}

void main() {
  vec2 p = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  // Перспектива: ближе к низу кадра облака дальше - мельче и медленнее.
  float z = 1.0 / (p.y * 0.75 + 0.5);
  vec2 base = vec2((p.x - 0.5) * aspect * z, z) * 0.9;
  float time = u_time * 0.012;
  float q = warp(base * 0.5);

  // Гребни: рваные края и складки.
  float r = 0.0;
  vec2 uv = base - q + time;
  float w = 0.8;
  for (int i = 0; i < SHAPE_OCT; i++) {
    r += abs(w * noise(uv));
    uv = M * uv + time;
    w *= 0.7;
  }

  // Форма облака.
  float f = 0.0;
  uv = base - q + time;
  w = 0.7;
  for (int i = 0; i < SHAPE_OCT; i++) {
    f += w * noise(uv);
    uv = M * uv + time;
    w *= 0.6;
  }
  f *= r + f;

  // Светотень: свой шум, мельче и быстрее - бугры на солнце и в тени.
  float c = 0.0;
  float t2 = time * 2.0;
  uv = base * 2.0 - q + t2;
  w = 0.4;
  for (int i = 0; i < LIGHT_OCT; i++) {
    c += w * noise(uv);
    uv = M * uv + t2;
    w *= 0.6;
  }
#if RIDGE
  float c1 = 0.0;
  float t3 = time * 3.0;
  uv = base * 3.0 - q + t3;
  w = 0.4;
  for (int i = 0; i < LIGHT_OCT; i++) {
    c1 += abs(w * noise(uv));
    uv = M * uv + t3;
    w *= 0.6;
  }
  c += c1;
#else
  c += 0.22;
#endif

  vec3 sky = mix(skyDay(p), skyDusk(p), u_night);
  // Свет на облаке чуть тёплый: иначе голубой отсвет неба делает белое бирюзовым.
  vec3 lit = mix(vec3(1.14, 1.11, 1.05), vec3(1.15, 0.92, 0.80), u_night);
  vec3 cloud = clamp(0.3 * sky + lit * clamp(0.6 + 0.3 * c, 0.0, 1.0), 0.0, 1.0);

  // Облачность: днём переменная; к ночи порог растёт - сперва тают тонкие
  // края, потом сжимаются и исчезают ядра.
  float cover = mix(-1.2, -0.6, clamp(u_cover / ${DAY_COVER.toFixed(2)}, 0.0, 1.2));
  float alpha = clamp(cover + 8.0 * f * r + 0.6 * c, 0.0, 1.0);
  alpha *= smoothstep(0.0, 0.3, p.y) * smoothstep(-1.2, -0.95, cover);
  vec3 col = mix(sky, cloud, alpha);

  // Шум против полос в градиенте неба.
  col += (texture2D(u_noise, gl_FragCoord.xy / 256.0).y - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;
}

/** Шумовая текстура: случайные значения с одним и тем же зерном - небо одинаковое при каждом входе. */
function noiseTexture(gl: WebGLRenderingContext): WebGLTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  let s = 20261007;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    data[i] = s >>> 24;
  }
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

/** Первая догадка по железу; дальше решают замеры кадров. */
function guessTier(gl: WebGLRenderingContext): Tier {
  try {
    const saved = Number(localStorage.getItem(TIER_KEY));
    if (saved >= 0 && saved <= 3 && localStorage.getItem(TIER_KEY) !== null) return saved as Tier;
  } catch {
    /* приватный режим */
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return 0;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (/intel|uhd|iris|mali|adreno|powervr|apple gpu/i.test(renderer) || mobile || weak) return 2;
  return 3;
}

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

type Props = { className?: string; onReady?: () => void };

export function SkyStage({ className = '', onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  // Без WebGL (старое железо, выключенное ускорение) - то же небо, но неподвижное.
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl || gl.isContextLost()) {
      setFallback(true);
      readyRef.current?.();
      return;
    }

    const programs = new Map<Tier, { prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }>();
    const build = (tier: Tier) => {
      const cached = programs.get(tier);
      if (cached) return cached;
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment(TIERS[tier])));
      gl.bindAttribLocation(prog, 0, 'a');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      const u = Object.fromEntries(['u_res', 'u_time', 'u_night', 'u_cover', 'u_noise'].map((n) => [n, gl.getUniformLocation(prog, n)]));
      const entry = { prog, u };
      programs.set(tier, entry);
      return entry;
    };

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    noiseTexture(gl);

    const reduced = prefersReducedMotion();
    let tier: Tier = reduced ? Math.min(guessTier(gl), 2) as Tier : guessTier(gl);
    let current = build(tier);
    if (!current) {
      setFallback(true);
      readyRef.current?.();
      return;
    }

    // Свет неба: night 0 - день, 1 - закат; cover - облачность.
    const night0 = currentTheme() === 'dark' ? 1 : 0;
    const look = { night: night0, cover: night0 ? 0 : DAY_COVER };
    let shift: { from: typeof look; to: typeof look; start: number } | null = null;
    const start = performance.now() - SKY_EPOCH_S * 1000;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = TIERS[tier].scale;
      const w = Math.max(1, Math.round(rect.width * scale));
      const h = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        draw(performance.now());
      }
    };

    const draw = (now: number) => {
      if (shift) {
        const k = Math.min(1, (now - shift.start) / (shift.to.cover > shift.from.cover ? 3000 : 2200));
        const kn = Math.min(1, (now - shift.start) / 1900);
        look.cover = shift.from.cover + (shift.to.cover - shift.from.cover) * ease(k);
        look.night = shift.from.night + (shift.to.night - shift.from.night) * ease(kn);
        if (k >= 1 && kn >= 1) shift = null;
      }
      const { prog, u } = current!;
      gl.useProgram(prog);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.u_res!, canvas.width, canvas.height);
      gl.uniform1f(u.u_time!, reduced ? SKY_EPOCH_S : (now - start) / 1000);
      gl.uniform1f(u.u_night!, look.night);
      gl.uniform1f(u.u_cover!, look.cover);
      gl.uniform1i(u.u_noise!, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // Замер: первые кадры без ограничения частоты; медленно - уровень ниже.
    let raf = 0;
    let last = 0;
    let probe: number[] = [];
    let probing = !reduced && tier > 0;
    let slowSince = 0;
    const setTier = (next: Tier) => {
      const built = build(next);
      if (!built) return;
      tier = next;
      current = built;
      resize();
      try {
        localStorage.setItem(TIER_KEY, String(next));
      } catch {
        /* приватный режим */
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const gap = now - last;
      if (probing) {
        if (last) probe.push(gap);
        last = now;
        draw(now);
        if (probe.length >= 45) {
          const sorted = [...probe].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)]!;
          probe = [];
          if (median > 24 && tier > 1) setTier((tier - 1) as Tier);
          else {
            probing = false;
            try {
              localStorage.setItem(TIER_KEY, String(tier));
            } catch {
              /* приватный режим */
            }
          }
        }
        return;
      }
      const interval = shift && tier >= 2 ? 15 : 32;
      if (gap < interval) return;
      // Долго не успеваем даже на 30 кадрах - ещё ступень вниз.
      if (gap > 60 && tier > 1) {
        slowSince ||= now;
        if (now - slowSince > 2500) {
          slowSince = 0;
          setTier((tier - 1) as Tier);
        }
      } else slowSince = 0;
      last = now;
      draw(now);
    };

    resize();
    draw(performance.now());
    readyRef.current?.();
    const animate = !reduced && tier > 0;
    if (animate) raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const offTheme = onThemeChange((theme: Theme) => {
      const to = theme === 'dark' ? { night: 1, cover: 0 } : { night: 0, cover: DAY_COVER };
      if (reduced || !animate) {
        Object.assign(look, to);
        draw(performance.now());
        return;
      }
      shift = { from: { ...look }, to, start: performance.now() };
    });
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden && animate) raf = requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      setFallback(true);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    // Контекст не гасим вручную: в разработке React монтирует эффект дважды,
    // и погашенный контекст полотно уже не вернуло бы.
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offTheme();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
    };
  }, []);

  return (
    <div className={`sky ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} className="sky-canvas" data-fallback={fallback} />
      {fallback ? (
        <div className="sky-fallback">
          <span className="sky-cloud c1" />
          <span className="sky-cloud c2" />
          <span className="sky-cloud c3" />
        </div>
      ) : null}
    </div>
  );
}
