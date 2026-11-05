import {
  Check, ChevronDown, ChevronLeft, ChevronRight, CircleX, ClipboardCopy, Copy, Download, Ellipsis, Equal, ExternalLink, Eye, File,
  FileBraces, FileCode, FileCog, FileDigit, FileImage, FileLock, FileMusic, FileTerminal, FileText, FileVideoCamera, Film, Folder, FolderOpen,
  House, Image, Keyboard, ClipboardPaste, KeyboardOff, List, Maximize2, PanelRight, Plus, RotateCw, Search, Server, Settings, SquarePlus, Terminal,
  TriangleAlert, Upload, WrapText, X, type LucideIcon,
} from "lucide-preact";

/** muxen's icon names, each a Lucide icon. */
const ICONS = {
  home: House,
  back: ChevronLeft,
  sessions: Server,
  folder: Folder,
  /** Go into a folder. */
  folderOpen: FolderOpen,
  /** The Files Preview panel's toggle. */
  panel: PanelRight,
  /** Open a preview full width. */
  expand: Maximize2,
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
  paste: ClipboardPaste,
  check: Check,
  alert: TriangleAlert,
  image: Image,
  film: Film,
  external: ExternalLink,
  /** All tabs: the tab list. */
  tabs: List,
  copy: Copy,
  /** Copies a file's text, not its path. */
  copyText: ClipboardCopy,
  download: Download,
  /** More actions: ⋯. */
  more: Ellipsis,
  wrap: WrapText,
  open: Eye,
  newTab: SquarePlus,
  // A file's kind, by its name: Files rows and headers.
  fileText: FileText,
  fileCode: FileCode,
  fileData: FileBraces,
  fileConfig: FileCog,
  fileLock: FileLock,
  fileScript: FileTerminal,
  fileImage: FileImage,
  fileVideo: FileVideoCamera,
  fileAudio: FileMusic,
  fileBinary: FileDigit,
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
