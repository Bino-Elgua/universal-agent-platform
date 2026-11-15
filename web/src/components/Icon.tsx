import type { CSSProperties } from 'react';
import {
  AppWindow, ArrowDown, ArrowUp, AudioLines, Check, ChevronDown, ChevronRight,
  Circle, Clock, Copy, Eye, File, Grid2X2, Hash, Maximize2, MessageSquare, Mic, Minimize2,
  Monitor, MoreHorizontal, MousePointer2, Paperclip, PanelLeft, Pencil, Plus,
  RefreshCw, Save, Search, Share2, Square, Star, X,
} from 'lucide-react';

export type IconName =
  | 'apps' | 'arrow_down' | 'chat_filled' | 'check' | 'chev_down' | 'chev_right' | 'clock' | 'close'
  | 'composer_plus' | 'copy' | 'edit' | 'file' | 'mic' | 'paperclip' | 'plus' | 'record' | 'save'
  | 'search' | 'share' | 'sidebar' | 'slack' | 'star' | 'voice_a' | 'voice_b'
  | 'arrow_up' | 'stop' | 'more' | 'monitor' | 'refresh'
  | 'eye' | 'pointer' | 'expand' | 'shrink';

// Licensed Lucide symbols replace the exported product-specific UI artwork.
const ICONS = {
  apps: Grid2X2, arrow_down: ArrowDown, chat_filled: MessageSquare, check: Check,
  chev_down: ChevronDown, chev_right: ChevronRight, clock: Clock, close: X,
  composer_plus: Plus, copy: Copy, edit: Pencil, file: File, mic: Mic,
  paperclip: Paperclip, plus: Plus, record: Circle, save: Save, search: Search,
  share: Share2, sidebar: PanelLeft, slack: Hash, star: Star, voice_a: AudioLines,
  voice_b: AppWindow, arrow_up: ArrowUp, stop: Square, more: MoreHorizontal,
  monitor: Monitor, refresh: RefreshCw, eye: Eye, pointer: MousePointer2,
  expand: Maximize2, shrink: Minimize2,
} satisfies Record<IconName, typeof Plus>;

interface Props { name: IconName; size?: number; opacity?: number; className?: string; style?: CSSProperties; color?: string }

export function Icon({ name, size = 16, opacity, className, style, color }: Props) {
  const Symbol = ICONS[name];
  return <Symbol aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} className={className} style={{ opacity, color, flexShrink: 0, ...style }} />;
}
