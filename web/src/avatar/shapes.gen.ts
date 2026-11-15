/** Original geometric badges, version 1. No upstream artwork or traced paths. */
export const AVATAR_ASSET_VERSION = 1;
export interface ShapeDef { viewBox: string; d: string; outline: string }
const polygon = (sides: number, radius = 19, rotation = -Math.PI / 2) =>
  Array.from({ length: sides }, (_, i) => {
    const angle = rotation + i * 2 * Math.PI / sides;
    return `${i ? 'L' : 'M'}${(24 + Math.cos(angle) * radius).toFixed(2)} ${(24 + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(' ') + 'Z';
const star = (points: number, inner = 12) => Array.from({ length: points * 2 }, (_, i) => {
  const angle = -Math.PI / 2 + i * Math.PI / points;
  const radius = i % 2 ? inner : 20;
  return `${i ? 'L' : 'M'}${(24 + Math.cos(angle) * radius).toFixed(2)} ${(24 + Math.sin(angle) * radius).toFixed(2)}`;
}).join(' ') + 'Z';
const circle = 'M24 4a20 20 0 1 1 0 40 20 20 0 1 1 0-40Z';
const rounded = 'M14 5h20a9 9 0 0 1 9 9v20a9 9 0 0 1-9 9H14a9 9 0 0 1-9-9V14a9 9 0 0 1 9-9Z';
const paths: Record<string, string> = {
  blob: circle, pebble: polygon(10), bean: 'M14 5h10a20 20 0 0 1 0 40H14a9 9 0 0 1-9-9V14a9 9 0 0 1 9-9Z',
  egg: 'M24 4C35 4 43 23 43 32c0 16-38 16-38 0C5 23 13 4 24 4Z',
  squircle: rounded, tablet: 'M15 4h18a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8H15a8 8 0 0 1-8-8V12a8 8 0 0 1 8-8Z',
  capsule: 'M4 24A15 15 0 0 1 19 9h10a15 15 0 0 1 0 30H19A15 15 0 0 1 4 24Z',
  cylinder: 'M6 12Q24 0 42 12v24Q24 48 6 36Z', hex: polygon(6), gem: polygon(4),
  crystal: polygon(5), wedge: polygon(3), shield: 'M5 8h38v16Q43 37 24 45 5 37 5 24Z',
  dome: 'M5 43V24a19 19 0 0 1 38 0v19Z', arch: 'M5 43V20a19 16 0 0 1 38 0v23Z',
  cloud: polygon(12), teardrop: 'M24 3C18 13 5 24 5 32a19 15 0 0 0 38 0C43 24 30 13 24 3Z',
  leaf: 'M5 43V24Q5 5 24 5h19v19Q43 43 24 43Z', square: 'M5 5h38v38H5Z',
  sparkle: star(4, 11), clover: star(8, 16), flower: star(12, 17),
  heart: 'M24 13C7-5-7 19 24 44 55 19 41-5 24 13Z',
  house: 'M4 20 24 4l20 16v23H4Z', star: star(5),
};
// Persisted shape IDs stay stable when upgrading existing agent profiles.
export const SHAPES: Record<string, ShapeDef> = Object.fromEntries(Object.entries(paths).map(([name, outline]) => [name, { viewBox: '0 0 48 48', d: outline, outline }]));
