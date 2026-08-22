/**
 * The app's icon set. CLAUDE.md §25, §36.
 *
 * Every icon is imported from its own module rather than from the
 * `lucide-react-native` barrel, and every screen imports from here.
 *
 * WHY: the barrel re-exports 1768 icons. Metro does not tree-shake in
 * development, so a single `import { Bell } from 'lucide-react-native'`
 * pulled all 1768 modules into the bundle — roughly 43% of the entire app —
 * to render the 27 icons actually used. That is minutes of bundling on a cold
 * cache and a blank screen while it happens.
 *
 * Deep imports are the supported path (the package publishes an
 * `./icons/*` export), and collecting them in one file keeps call sites
 * clean: screens still write `import { Bell } from '…/ui/icons'`.
 *
 * To add an icon: find its kebab-case name in lucide-react-native/icons and
 * add a line below. Do NOT import from the package root.
 */
// renamed upstream to "triangle-alert"
export { default as AlertTriangle } from 'lucide-react-native/icons/triangle-alert';
export { default as Banknote } from 'lucide-react-native/icons/banknote';
export { default as Bell } from 'lucide-react-native/icons/bell';
export { default as BellRing } from 'lucide-react-native/icons/bell-ring';
export { default as Building2 } from 'lucide-react-native/icons/building-2';
export { default as CalendarClock } from 'lucide-react-native/icons/calendar-clock';
export { default as CalendarDays } from 'lucide-react-native/icons/calendar-days';
export { default as Check } from 'lucide-react-native/icons/check';
// renamed upstream to "circle-check-big"
export { default as CheckCircle2 } from 'lucide-react-native/icons/circle-check-big';
export { default as ChevronDown } from 'lucide-react-native/icons/chevron-down';
export { default as ChevronLeft } from 'lucide-react-native/icons/chevron-left';
export { default as ChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as ChevronUp } from 'lucide-react-native/icons/chevron-up';
export { default as CircleDashed } from 'lucide-react-native/icons/circle-dashed';
export { default as CircleSlash } from 'lucide-react-native/icons/circle-slash';
export { default as Clock } from 'lucide-react-native/icons/clock';
export { default as Copy } from 'lucide-react-native/icons/copy';
export { default as DoorOpen } from 'lucide-react-native/icons/door-open';
export { default as Droplet } from 'lucide-react-native/icons/droplet';
export { default as Eye } from 'lucide-react-native/icons/eye';
export { default as EyeOff } from 'lucide-react-native/icons/eye-off';
export { default as Gauge } from 'lucide-react-native/icons/gauge';
// renamed upstream to "house"
export { default as Home } from 'lucide-react-native/icons/house';
export { default as Info } from 'lucide-react-native/icons/info';
export { default as KeyRound } from 'lucide-react-native/icons/key-round';
export { default as Layers } from 'lucide-react-native/icons/layers';
export { default as LogOut } from 'lucide-react-native/icons/log-out';
export { default as MailCheck } from 'lucide-react-native/icons/mail-check';
export { default as Pencil } from 'lucide-react-native/icons/pencil';
export { default as Plus } from 'lucide-react-native/icons/plus';
export { default as Receipt } from 'lucide-react-native/icons/receipt';
export { default as ReceiptText } from 'lucide-react-native/icons/receipt-text';
export { default as RotateCcw } from 'lucide-react-native/icons/rotate-ccw';
export { default as ShieldAlert } from 'lucide-react-native/icons/shield-alert';
export { default as ShieldCheck } from 'lucide-react-native/icons/shield-check';
export { default as Sparkles } from 'lucide-react-native/icons/sparkles';
export { default as Trash2 } from 'lucide-react-native/icons/trash-2';
export { default as TrendingUp } from 'lucide-react-native/icons/trending-up';
export { default as User } from 'lucide-react-native/icons/user';
export { default as Users } from 'lucide-react-native/icons/users';
export { default as Wallet } from 'lucide-react-native/icons/wallet';
export { default as Wifi } from 'lucide-react-native/icons/wifi';
export { default as Zap } from 'lucide-react-native/icons/zap';
