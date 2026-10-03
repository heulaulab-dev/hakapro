import * as L from "lucide-react"
import type { ComponentProps, ComponentType } from "react"

// Lucide icons tuned to the reference's thin 14px glyphs. Import icons from here, not lucide-react.
type IconProps = ComponentProps<"svg"> & { strokeWidth?: number }
export type Icon = ComponentType<IconProps>

function tune(Base: L.LucideIcon, strokeWidth = 1.6): Icon {
  function Tuned(props: IconProps) {
    return <Base strokeWidth={strokeWidth} aria-hidden="true" {...(props as L.LucideProps)} />
  }
  Tuned.displayName = Base.displayName
  return Tuned
}

export const Activity = tune(L.Activity)
export const AlertTriangle = tune(L.TriangleAlert)
export const ArrowLeft = tune(L.ArrowLeft)
export const ArrowRight = tune(L.ArrowRight)
export const ArrowUpRight = tune(L.ArrowUpRight)
export const BadgePercent = tune(L.BadgePercent)
export const Banknote = tune(L.Banknote)
export const BookOpen = tune(L.BookOpen)
export const Bot = tune(L.Bot)
export const Bell = tune(L.Bell)
export const Briefcase = tune(L.Briefcase)
export const Building = tune(L.Building2)
export const Calculator = tune(L.Calculator)
export const Calendar = tune(L.Calendar)
export const CalendarClock = tune(L.CalendarClock)
export const ChartColumn = tune(L.ChartColumn)
export const Check = tune(L.Check, 2)
export const ChevronDown = tune(L.ChevronDown, 1.8)
export const ChevronLeft = tune(L.ChevronLeft, 1.8)
export const ChevronRight = tune(L.ChevronRight, 1.8)
export const ChevronUp = tune(L.ChevronUp, 1.8)
export const Circle = tune(L.Circle)
export const CircleCheck = tune(L.CircleCheck)
export const CircleDollar = tune(L.CircleDollarSign)
export const Clock = tune(L.Clock)
export const Columns = tune(L.Columns2)
export const Copy = tune(L.Copy)
export const CreditCard = tune(L.CreditCard)
export const Download = tune(L.Download)
export const Ellipsis = tune(L.Ellipsis, 2)
export const Eye = tune(L.Eye)
export const EyeOff = tune(L.EyeOff)
export const FileCheck = tune(L.FileCheck2)
export const FlaskConical = tune(L.FlaskConical)
export const FileSignature = tune(L.FileSignature)
export const FileText = tune(L.FileText)
export const Files = tune(L.Files)
export const Filter = tune(L.ListFilter)
export const FolderKanban = tune(L.FolderKanban)
export const Globe = tune(L.Globe)
export const GripVertical = tune(L.GripVertical)
export const HandCoins = tune(L.HandCoins)
export const Hash = tune(L.Hash)
export const History = tune(L.History)
export const ImageIcon = tune(L.Image)
export const Inbox = tune(L.Inbox)
export const Info = tune(L.Info)
export const KeyRound = tune(L.KeyRound)
export const Layers = tune(L.Layers)
export const LayoutGrid = tune(L.LayoutGrid)
export const LifeBuoy = tune(L.LifeBuoy)
export const Lock = tune(L.Lock)
export const LogOut = tune(L.LogOut)
export const Mail = tune(L.Mail)
export const MailCheck = tune(L.MailCheck)
export const MapPin = tune(L.MapPin)
export const Menu = tune(L.Menu)
export const Package = tune(L.Package)
export const Palette = tune(L.Palette)
export const PanelLeft = tune(L.PanelLeft)
export const Pause = tune(L.Pause)
export const Pencil = tune(L.Pencil)
export const Percent = tune(L.Percent)
export const Phone = tune(L.Phone)
export const Play = tune(L.Play)
export const Plug = tune(L.Plug)
export const Plus = tune(L.Plus, 1.8)
export const Printer = tune(L.Printer)
export const Receipt = tune(L.ReceiptText)
export const RefreshCw = tune(L.RefreshCw)
export const Repeat = tune(L.Repeat)
export const ScrollText = tune(L.ScrollText)
export const Signature = tune(L.Signature)
export const Search = tune(L.Search)
export const Send = tune(L.Send)
export const Settings = tune(L.Settings2)
export const Share = tune(L.Share)
export const ShieldCheck = tune(L.ShieldCheck)
export const SlidersHorizontal = tune(L.SlidersHorizontal)
export const Sparkles = tune(L.Sparkles)
export const SquareKanban = tune(L.SquareKanban)
export const Stamp = tune(L.Stamp)
export const Tag = tune(L.Tag)
export const Trash = tune(L.Trash2)
export const TrendingUp = tune(L.TrendingUp)
export const Type = tune(L.Type)
export const Upload = tune(L.Upload)
export const UserPlus = tune(L.UserPlus)
export const UserRound = tune(L.UserRound)
export const Users = tune(L.Users)
export const Wallet = tune(L.Wallet)
export const X = tune(L.X, 1.8)
export const ZoomIn = tune(L.ZoomIn)
export const ZoomOut = tune(L.ZoomOut)

export function GoogleIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.26-.96 2.33-2.04 3.05l3.3 2.56c1.92-1.77 3.03-4.38 3.03-7.48 0-.72-.06-1.41-.18-2.07H12z" />
      <path fill="#34A853" d="M5.84 14.1l-.74.57-2.63 2.05C4.14 20.04 7.79 22.3 12 22.3c2.78 0 5.12-.92 6.82-2.5l-3.3-2.56c-.92.62-2.08.98-3.52.98-2.7 0-5-1.83-5.82-4.29z" />
      <path fill="#4A90E2" d="M2.47 7.28A10.2 10.2 0 0 0 1.7 12c0 1.69.4 3.28 1.1 4.72l3.04-2.62A6.1 6.1 0 0 1 5.6 12c0-.73.13-1.43.35-2.1z" />
      <path fill="#FBBC05" d="M12 5.6c1.53 0 2.9.53 3.98 1.56l2.94-2.94C17.12 2.53 14.78 1.7 12 1.7 7.79 1.7 4.14 3.96 2.47 7.28l3.48 2.62C6.98 7.43 9.3 5.6 12 5.6z" />
    </svg>
  )
}

export function GitHubIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 1.7C6.2 1.7 1.5 6.4 1.5 12.2c0 4.64 3 8.57 7.17 9.96.53.1.72-.23.72-.5v-1.77c-2.92.64-3.53-1.4-3.53-1.4-.48-1.22-1.17-1.54-1.17-1.54-.95-.65.07-.64.07-.64 1.05.08 1.6 1.08 1.6 1.08.94 1.6 2.46 1.14 3.06.87.1-.68.37-1.14.66-1.4-2.33-.27-4.78-1.17-4.78-5.18 0-1.15.41-2.08 1.08-2.82-.1-.27-.47-1.33.1-2.78 0 0 .88-.28 2.89 1.07a10 10 0 0 1 5.26 0c2-1.35 2.88-1.07 2.88-1.07.58 1.45.21 2.51.11 2.78.67.74 1.08 1.67 1.08 2.82 0 4.02-2.46 4.9-4.8 5.16.38.33.72.97.72 1.96v2.9c0 .28.19.61.73.5a10.5 10.5 0 0 0 7.16-9.95C22.5 6.4 17.8 1.7 12 1.7z" />
    </svg>
  )
}
