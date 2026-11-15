import type { CSSProperties } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardList, Download, FileText, Folder, Play, Settings, Sparkles, Trash2 } from 'lucide-react';

const GLYPHS = {
  trash: Trash2, download: Download, folder: Folder, doc: FileText, gear: Settings,
  play: Play, check_circle: CheckCircle2, spark: Sparkles, arrow_left: ArrowLeft, tasks: ClipboardList,
};
export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, size = 16, opacity, style, className }: { name: GlyphName; size?: number; opacity?: number; style?: CSSProperties; className?: string }) {
  const Symbol = GLYPHS[name];
  return <Symbol aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} className={className} style={{ opacity, flexShrink: 0, ...style }} />;
}
