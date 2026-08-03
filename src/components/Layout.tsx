import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Database, 
  MessageSquare, 
  FileBarChart, 
  Settings, 
  User as UserIcon,
  Menu,
  X,
  ShieldCheck,
  ChevronDown,
  LogOut
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { motion, AnimatePresence } from 'motion/react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import type { NavLinkRenderProps } from 'react-router-dom';
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';

interface LayoutProps {
  children: React.ReactNode;
}

const roleDetails = {
  SYSTEM_ADMIN: {
    name: 'Quản trị viên Hệ thống',
    label: 'SYSTEM ADMIN',
    color: 'border-indigo-200 bg-indigo-50/40 text-indigo-700 hover:bg-indigo-50',
    icon: ShieldCheck,
  },
  SALES_ADMIN: {
    name: 'Quản trị viên Kinh doanh',
    label: 'SALES ADMIN',
    color: 'border-emerald-200 bg-emerald-50/40 text-emerald-700 hover:bg-emerald-50',
    icon: Database,
  },
  SALES_MANAGER: {
    name: 'Giám đốc Kinh doanh',
    label: 'SALES MANAGER',
    color: 'border-amber-200 bg-amber-50/40 text-amber-700 hover:bg-amber-50',
    icon: FileBarChart,
  }
};

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { profile, selectRole, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const navItems = [
    { name: 'Tổng quan', path: '/', icon: LayoutDashboard, roles: ['SALES_ADMIN', 'SALES_MANAGER', 'SYSTEM_ADMIN'] },
    { name: 'Quản lý dữ liệu', path: '/data', icon: Database, roles: ['SALES_ADMIN', 'SYSTEM_ADMIN'] },
    { name: 'Trợ lý AI', path: '/chat', icon: MessageSquare, roles: ['SALES_ADMIN', 'SALES_MANAGER', 'SYSTEM_ADMIN'] },
    { name: 'Báo cáo', path: '/reports', icon: FileBarChart, roles: ['SALES_MANAGER', 'SYSTEM_ADMIN'] },
    { name: 'Cấu hình', path: '/settings', icon: Settings, roles: ['SALES_ADMIN', 'SALES_MANAGER', 'SYSTEM_ADMIN'] },
  ];

  const filteredNavItems = navItems.filter(item => profile && item.roles.includes(profile.role));

  const currentRole = profile?.role || 'SYSTEM_ADMIN';
  const roleConfig = roleDetails[currentRole as keyof typeof roleDetails] || roleDetails.SYSTEM_ADMIN;
  const RoleIcon = roleConfig.icon;

  return (
    <div className="flex h-screen bg-sky-50/50 overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-sky-100/60 shadow-sm relative z-20">
        <div className="p-6 flex items-center gap-3.5 border-b border-sky-100/40">
          <div className="relative flex items-center justify-center w-12 h-12 bg-gradient-to-tr from-sky-600 via-sky-500 to-cyan-400 text-white rounded-2xl shadow-lg shadow-sky-500/20 overflow-hidden group border border-sky-400/20 shrink-0">
            {/* Glossy reflection effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-60" />
            {/* Glow background ring */}
            <div className="absolute -inset-1 bg-gradient-to-r from-sky-400 to-cyan-300 rounded-2xl blur-xs opacity-40 group-hover:opacity-80 transition-opacity duration-300" />
            
            {/* Crisp vibrant white vector trend-up icon */}
            <svg viewBox="0 0 24 24" fill="none" className="w-6.5 h-6.5 z-10 text-white transition-transform duration-500 group-hover:scale-110 group-hover:rotate-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 20h18" stroke="rgba(255,255,255,0.45)" strokeWidth="2" />
              <path d="M18 6l-6.5 6.5-3.5-3.5L4 13" stroke="white" strokeWidth="3" />
              <circle cx="18" cy="6" r="2" fill="#22d3ee" stroke="white" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <h2 className="text-[20px] font-black text-slate-900 tracking-tight leading-snug font-heading whitespace-nowrap">
              Sales <span className="bg-gradient-to-r from-sky-600 to-sky-400 bg-clip-text text-transparent">Intelligence</span>
            </h2>
          </div>
        </div>
 
        <nav className="flex-1 px-4 py-6 space-y-2">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className="block focus:outline-none"
            >
              {({ isActive }: NavLinkRenderProps) => (
                <div className={cn(
                  "flex items-center gap-3.5 px-4 py-3 rounded-2xl text-[17px] font-bold tracking-wide transition-all duration-300 border-none shrink-0 cursor-pointer",
                  isActive 
                    ? "bg-gradient-to-r from-sky-500 to-sky-600 text-white shadow-md shadow-sky-500/15 border-l-4 border-sky-300 translate-x-1 pl-3.5" 
                    : "text-slate-600 hover:bg-sky-50/50 hover:text-sky-700 hover:translate-x-1 pl-4"
                )}>
                  <item.icon size={20} className={cn("transition-colors duration-300", isActive ? "text-white scale-110" : "text-slate-400 group-hover:text-sky-500")} />
                  {item.name}
                </div>
              )}
            </NavLink>
          ))}
        </nav>
 
        <div className="p-4 mt-auto space-y-3">
          <div className="bg-sky-50/40 border border-sky-100/60 rounded-3xl p-3 flex items-center justify-between gap-2 shadow-xs hover:bg-sky-50 hover:border-sky-200 transition-all group">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="flex-1 min-w-0 flex items-center gap-2.5 cursor-pointer">
                  <Avatar className="h-9 w-9 border border-sky-200 group-hover:scale-105 transition-transform shrink-0">
                    <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profile?.id}`} />
                    <AvatarFallback>{profile?.fullName?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14.5px] font-black text-slate-900 truncate leading-tight">{profile?.fullName}</p>
                    <p className="text-[11px] font-bold text-sky-700 uppercase tracking-wider mt-0.5 flex items-center gap-0.5">
                      {roleConfig.label}
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </p>
                  </div>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-64 rounded-2xl p-2 bg-white border border-sky-100 shadow-xl">
                <DropdownMenuLabel className="text-[13px] text-slate-400 font-bold uppercase tracking-wider px-3 py-1.5">
                  Chuyển nhanh Vai trò
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1 bg-sky-100/40" />
                {Object.entries(roleDetails).map(([roleKey, details]) => {
                  const ItemIcon = details.icon;
                  const isSelected = currentRole === roleKey;
                  return (
                    <DropdownMenuItem
                      key={roleKey}
                      onClick={() => selectRole(roleKey as any)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-[15px] font-bold transition-all duration-200 my-0.5",
                        isSelected 
                          ? "bg-sky-500 text-white shadow-xs" 
                          : "text-slate-700 hover:bg-sky-50 hover:text-sky-700"
                      )}
                    >
                      <ItemIcon className={cn("w-4.5 h-4.5", isSelected ? "text-white" : "text-slate-400")} />
                      <div className="flex flex-col items-start">
                        <span>{details.name}</span>
                        <span className={cn("text-[11px] font-medium tracking-wide leading-none mt-0.5", isSelected ? "text-sky-100" : "text-slate-400")}>
                          {details.label}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator className="my-1 bg-sky-100/40" />
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                  }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-[15px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-all duration-200"
                >
                  <LogOut className="w-4.5 h-4.5 text-rose-500" />
                  <span>Đăng xuất</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Direct logout button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={async (e) => {
                e.stopPropagation();
                await logout();
              }}
              title="Đăng xuất"
              className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl h-8 w-8 transition-colors shrink-0 cursor-pointer"
            >
              <LogOut size={15} />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/40 md:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <motion.aside 
              initial={{ x: -250 }}
              animate={{ x: 0 }}
              exit={{ x: -250 }}
              className="w-64 h-full bg-white shadow-2xl flex flex-col justify-between"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 flex items-center justify-between border-b border-sky-100/40">
                  <div className="flex items-center gap-3">
                    <div className="relative flex items-center justify-center w-10 h-10 bg-gradient-to-tr from-sky-600 to-cyan-400 text-white rounded-xl shadow-md overflow-hidden group border border-sky-400/20 shrink-0">
                      <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-60" />
                      <svg viewBox="0 0 24 24" fill="none" className="w-5.5 h-5.5 z-10 text-white" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 20h18" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
                        <path d="M18 6l-6.5 6.5-3.5-3.5L4 13" stroke="white" strokeWidth="3" />
                      </svg>
                    </div>
                    <div className="flex flex-col justify-center min-w-0">
                      <span className="font-black text-[19px] text-slate-900 leading-none font-heading whitespace-nowrap">Sales Intel</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(false)} className="rounded-xl h-9 w-9 hover:bg-sky-50 text-slate-500">
                    <X size={20} />
                  </Button>
                </div>
                <nav className="px-4 py-6 space-y-2">
                  {filteredNavItems.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="block focus:outline-none"
                    >
                      {({ isActive }) => (
                        <div className={cn(
                          "flex items-center gap-3.5 px-4 py-3 rounded-2xl text-[17px] font-bold tracking-wide transition-all duration-300",
                          isActive 
                            ? "bg-gradient-to-r from-sky-500 to-sky-600 text-white shadow-md shadow-sky-500/15 border-l-4 border-sky-300 pl-3.5" 
                            : "text-slate-600 hover:bg-sky-50/50 hover:text-sky-700"
                        )}>
                          <item.icon size={20} className={cn("transition-colors duration-300", isActive ? "text-white scale-110" : "text-slate-400")} />
                          {item.name}
                        </div>
                      )}
                    </NavLink>
                  ))}
                </nav>
              </div>
              
              <div className="p-4 border-t border-sky-100/40 bg-white">
                <div className="flex items-center gap-3 mb-3 p-2">
                  <Avatar className="h-10 w-10 border border-sky-200">
                    <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profile?.id}`} />
                    <AvatarFallback>{profile?.fullName?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-black text-slate-900 truncate leading-tight">{profile?.fullName}</p>
                    <p className="text-[11px] font-bold text-sky-700 uppercase tracking-wider mt-0.5">
                      {roleConfig.label}
                    </p>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  onClick={async () => {
                    setIsMobileMenuOpen(false);
                    await logout();
                  }} 
                  className="w-full justify-start gap-3 h-11 rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700 font-bold text-[15px]"
                >
                  <LogOut size={18} className="text-rose-500" />
                  Đăng xuất
                </Button>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 bg-white/90 backdrop-blur-md border-b border-sky-100/80 shadow-xs shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsMobileMenuOpen(true)}>
              <Menu size={24} />
            </Button>
            <h2 className="text-[21px] font-bold text-slate-800 hidden md:block">
              {navItems.find(i => i.path === window.location.pathname)?.name || 'Dashboard'}
            </h2>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Elegant Role Switcher Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-1.5 h-10 rounded-2xl border transition-all duration-300 font-bold text-[14px]",
                    roleConfig.color
                  )}
                >
                  <RoleIcon className="w-4 h-4" />
                  <span className="hidden sm:inline">{roleConfig.name}</span>
                  <span className="inline sm:hidden">{roleConfig.label}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl p-2 bg-white border border-sky-100 shadow-xl">
                <DropdownMenuLabel className="text-[13px] text-slate-400 font-bold uppercase tracking-wider px-3 py-1.5">
                  Chọn Vai trò Hệ thống
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="my-1 bg-sky-100/40" />
                
                {Object.entries(roleDetails).map(([roleKey, details]) => {
                  const ItemIcon = details.icon;
                  const isSelected = currentRole === roleKey;
                  return (
                    <DropdownMenuItem
                      key={roleKey}
                      onClick={() => selectRole(roleKey as any)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-[15px] font-bold transition-all duration-200 my-0.5",
                        isSelected 
                          ? "bg-sky-500 text-white shadow-xs" 
                          : "text-slate-700 hover:bg-sky-50 hover:text-sky-700"
                      )}
                    >
                      <ItemIcon className={cn("w-4.5 h-4.5", isSelected ? "text-white" : "text-slate-400")} />
                      <div className="flex flex-col items-start">
                        <span>{details.name}</span>
                        <span className={cn("text-[11px] font-medium tracking-wide leading-none mt-0.5", isSelected ? "text-sky-100" : "text-slate-400")}>
                          {details.label}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator className="my-1 bg-sky-100/40" />
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                  }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-[15px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-all duration-200"
                >
                  <LogOut className="w-4.5 h-4.5 text-rose-500" />
                  <span>Đăng xuất</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="text-right hidden lg:block">
              <p className="text-[13px] text-slate-400 font-bold uppercase tracking-tight">Hôm nay</p>
              <p className="text-[15px] font-extrabold text-slate-700">
                {new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
            
            <Avatar className="h-8 w-8 md:hidden">
               <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profile?.id}`} />
               <AvatarFallback>{profile?.fullName?.charAt(0)}</AvatarFallback>
            </Avatar>
          </div>
        </header>

        {/* Content Area */}
        <section className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <motion.div
            key={window.location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
        </section>
      </main>
    </div>
  );
};
