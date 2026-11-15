import type { AvatarColor } from '@shared/types';

/**
 * Bot colors. `fill` is the avatar/swatch color, `bubble` the user message bubble, `action` the
 * accent for toggles and the send button, and `hover` its hover state.
 */
export interface BotPalette { fill: string; bubble: string; action: string; hover: string }

export const BOT_COLORS: Record<AvatarColor, BotPalette> = {
  // Black follows the theme (ink on light, light ink on dark), so it uses tokens instead of hex.
  black: { fill: '#182F3A', bubble: 'var(--color-bubble-user)', action: 'var(--color-primary)', hover: 'var(--color-bg-primary-hover)' },
  brown: { fill: '#846347', bubble: '#60452F', action: '#715138', hover: '#60452F' },
  red: { fill: '#B7494D', bubble: '#903238', action: '#A23D43', hover: '#903238' },
  orange: { fill: '#BE6A30', bubble: '#88481E', action: '#A95827', hover: '#88481E' },
  yellow: { fill: '#B88C23', bubble: '#735511', action: '#8F6B16', hover: '#735511' },
  green: { fill: '#3D8864', bubble: '#276346', action: '#327752', hover: '#276346' },
  cyan: { fill: '#27868B', bubble: '#1B6066', action: '#22747A', hover: '#1B6066' },
  blue: { fill: '#3E74A8', bubble: '#2A547F', action: '#346593', hover: '#2A547F' },
  violet: { fill: '#7961AA', bubble: '#59427E', action: '#695096', hover: '#59427E' },
  magenta: { fill: '#A75588', bubble: '#7A3862', action: '#914875', hover: '#7A3862' },
  gray: { fill: '#73838B', bubble: '#4C5E67', action: '#5C707A', hover: '#4C5E67' },
};

/** Swatch order in the Create New Bot picker. */
export const COLOR_ORDER: AvatarColor[] = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'gray'];

export const palette = (c: AvatarColor | string | undefined): BotPalette => BOT_COLORS[(c as AvatarColor) ?? 'black'] ?? BOT_COLORS.black;

/** CSS custom properties that theme a subtree with a bot's color. */
export function botVars(c: AvatarColor | string | undefined): React.CSSProperties {
  const p = palette(c);
  return {
    ['--bot-fill' as string]: p.fill, ['--bot-bubble' as string]: p.bubble, ['--bot-action' as string]: p.action, ['--bot-action-hover' as string]: p.hover,
    ['--bot-on-action' as string]: p === BOT_COLORS.black ? 'var(--color-on-primary)' : '#FFFFFF',
    ['--bot-action-soft' as string]: `color-mix(in srgb, ${p.action} 13%, transparent)`,
    ['--bot-action-text' as string]: p === BOT_COLORS.black ? 'var(--color-text-secondary)' : p.action,
  };
}
