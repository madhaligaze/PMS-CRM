/**
 * Единственная точка входа GSAP. Плагины регистрируются здесь; компоненты
 * берут gsap только отсюда.
 *
 * Правила слоя движения (каждое уже стоило дефекта в прошлом проекте):
 * 1. Свойство, которое анимирует GSAP, не задаётся в CSS. Прятать - через
 *    visibility/opacity, сдвиг отдавать GSAP целиком.
 * 2. Текст под SplitText на месте не меняется: сменился текст - новый key.
 *    Резать только вместе со словами (lines,words,chars).
 * 3. Рядом с полноэкранными слоями - только opacity: transform на предке
 *    делает его контейнером для position: fixed.
 */
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(useGSAP, SplitText, DrawSVGPlugin, MotionPathPlugin);
gsap.defaults({ ease: 'expo.out', duration: 0.6 });

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export { DrawSVGPlugin, gsap, MotionPathPlugin, SplitText, useGSAP };
