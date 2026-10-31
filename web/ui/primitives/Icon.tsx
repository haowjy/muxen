import {
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleX, Equal, ExternalLink, File, Film, Folder, House, Image, Keyboard,
  KeyboardOff, Plus, RotateCw, Search, Server, Settings, Terminal, TriangleAlert, Upload, X, type LucideIcon,
} from "lucide-preact";

/** tether's icon names, each a Lucide icon. */
const ICONS = {
  home: House,
  back: ChevronLeft,
  sessions: Server,
  folder: Folder,
  plus: Plus,
  close: X,
  /** A tab's close: the × in a ring, as a pill's own control. */
  closeCircle: CircleX,
  keyboard: Keyboard,
  keyboardHide: KeyboardOff,
  /** The drag handle: two bars. */
  grip: Equal,
  chevron: ChevronRight,
  chevronDown: ChevronDown,
  search: Search,
  terminal: Terminal,
  file: File,
  refresh: RotateCw,
  settings: Settings,
  upload: Upload,
  check: Check,
  alert: TriangleAlert,
  image: Image,
  film: Film,
  external: ExternalLink,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;
export type IconSize = 16 | 20 | 24;

interface IconProps {
  name: IconName;
  size?: IconSize;
  class?: string | undefined;
}

/** A Lucide stroke icon in the current text colour. Decorative: name the control, not the icon. */
export function Icon({ name, size = 20, class: className }: IconProps) {
  const Glyph = ICONS[name];
  return <Glyph size={size} class={className} aria-hidden="true" focusable="false" />;
}
