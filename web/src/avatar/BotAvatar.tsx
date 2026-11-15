import type { AvatarColor, AvatarShape, Bot } from '@shared/types';
import { palette } from '../lib/colors';
import { Icon } from '../components/Icon';
import { AVATAR_ASSET_VERSION, SHAPES, type ShapeDef } from './shapes.gen';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working' | 'success' | 'error' | 'sleep';
export function shapeDef(shape: AvatarShape | string): ShapeDef {
  return SHAPES[shape] ?? SHAPES.blob;
}
export const PICKER_SHAPES: AvatarShape[] = ['blob', 'cloud', 'square', 'sparkle', 'clover', 'heart', 'flower', 'teardrop', 'tablet', 'wedge', 'house', 'star', 'hex'];

interface Props {
  shape: AvatarShape | string;
  color: AvatarColor | string;
  size: number;
  star?: boolean;
  ring?: boolean;
  state?: AvatarState;
  className?: string;
  title?: string;
}

/** First-party node badge. Motion expresses activity, never a provider or permissions. */
export function BotAvatar({ shape, color, size, star, ring, state = 'idle', className, title }: Props) {
  const def = shapeDef(shape);
  const fill = palette(color).fill;
  return (
    <span className={`bot-avatar ${className ?? ''}`} style={{ width: size, height: size }} title={title} role={title ? 'img' : undefined} aria-label={title ? `${title}, ${state}` : undefined} aria-hidden={title ? undefined : true} data-state={state} data-asset-version={AVATAR_ASSET_VERSION}>
      <svg width={size} height={size} viewBox={def.viewBox} aria-hidden="true" focusable="false">
        <path d={def.outline} fill={fill} stroke={ring ? 'var(--color-text-primary)' : 'none'} strokeWidth={2} />
        <g className="bot-avatar__nodes" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M24 24 14 17M24 24l10-7M24 24v11" />
          <circle cx="14" cy="17" r="3" fill={fill} />
          <circle cx="34" cy="17" r="3" fill={fill} />
          <circle cx="24" cy="35" r="3" fill={fill} />
          <circle cx="24" cy="24" r="4" fill="#FFFFFF" />
        </g>
        {state === 'success' && <path d="m17 25 5 5 10-12" fill="none" stroke="#FFFFFF" strokeWidth={3} />}
        {state === 'error' && <path d="M24 14v14m0 5v1" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" />}
      </svg>
      {star && <span className="bot-avatar__star" style={{ width: size * 0.3, height: size * 0.3 }}><Icon name="star" size={size * 0.2} color="#FFFFFF" /></span>}
    </span>
  );
}

export function BotAvatarFor({ bot, size, star, state, className }: { bot: Pick<Bot, 'avatarShape' | 'avatarColor' | 'name'> & { isPrimary?: boolean }; size: number; star?: boolean; state?: AvatarState; className?: string }) {
  return <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} size={size} star={star} state={state} className={className} title={bot.name} />;
}
