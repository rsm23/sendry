import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, Bell, Bot, ChartNoAxesCombined, ChevronDown, FileStack, Files, Gauge, Inbox, ListFilter, LogOut, RadioTower,
  Mail, Megaphone, Plus, Search, Settings, ShieldCheck, Sparkles, UsersRound, Workflow,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { get } from '@/lib/api'

type NotificationOverview = { alerts: Array<{ id: string; severity: string; title: string; detail: string }>; campaigns: Array<{ id: string; subject: string; status: string; scheduled_at?: string }> }

const navigation = [
  { label: 'Overview', path: '/overview', icon: Gauge, permission: null },
  { label: 'Campaigns', path: '/campaigns', icon: Megaphone, permission: 'campaigns' },
  { label: 'Templates', path: '/templates', icon: FileStack, permission: 'templates' },
  { label: 'Audiences', path: '/audiences', icon: UsersRound, permission: 'lists' },
  { label: 'Automations', path: '/automations', icon: Workflow, permission: 'automations' },
  { label: 'Inbox', path: '/inbox', icon: Inbox, permission: 'inbox' },
  { label: 'Reports', path: '/reports', icon: ChartNoAxesCombined, permission: 'reports' },
  { label: 'Files', path: '/files', icon: Files, permission: 'files' },
  { label: 'Rules', path: '/rules', icon: ShieldCheck, permission: 'rules' },
  { label: 'Channels', path: '/channels', icon: RadioTower, permission: 'channels' },
]

export function AppShell() {
  const { brand, brands, user, selectBrand, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const notifications = useQuery({ queryKey: ['shell-notifications', brand?.id], queryFn: () => get<NotificationOverview>(`/api/brands/${brand?.id}/overview`), enabled: !!brand, refetchInterval: 60_000 })
  const permissions = useMemo(() => (brand?.permissions as string[] | undefined) ?? [], [brand?.permissions])
  const availableNavigation = useMemo(() => navigation.filter((item) => !item.permission || permissions.includes('*') || permissions.includes(item.permission) || (item.permission === 'inbox' && permissions.includes('campaigns')) || (item.permission === 'channels' && permissions.includes('settings'))), [permissions])
  const active = useMemo(() => availableNavigation.find((item) => location.pathname.startsWith(item.path)), [availableNavigation, location.pathname])
  const can = (permission: string) => permissions.includes('*') || permissions.includes(permission)

  return (
    <SidebarProvider style={{ '--sidebar-width': '14.25rem' } as React.CSSProperties}>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="gap-3 px-3 py-4">
          <button className="flex h-9 items-center gap-2 px-1 text-left" onClick={() => navigate('/overview')} aria-label="Sendry overview">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><Mail className="size-4"/></span>
            <span className="text-lg font-semibold tracking-[-0.04em] group-data-[collapsible=icon]:hidden">Sendry</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="flex h-10 w-full items-center gap-2 rounded-md border border-sidebar-border bg-white/4 px-2 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"/>}>
              <span className="grid size-6 shrink-0 place-items-center rounded border border-sidebar-border"><Activity className="size-3.5"/></span>
              <span className="min-w-0 flex-1 truncate text-left font-medium group-data-[collapsible=icon]:hidden">{brand?.name ?? 'Select brand'}</span>
              <ChevronDown className="size-4 group-data-[collapsible=icon]:hidden"/>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Brands</DropdownMenuLabel>
                {brands.map((item) => <DropdownMenuItem key={item.id} onClick={() => selectBrand(item.id)}>{item.name}</DropdownMenuItem>)}
              </DropdownMenuGroup>
              {can('settings') && <><DropdownMenuSeparator/><DropdownMenuItem onClick={() => navigate('/settings')}><Plus/> Add or manage brands</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarHeader>
        <SidebarContent className="px-2">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {availableNavigation.map((item) => {
                  const isActive = location.pathname.startsWith(item.path)
                  return <SidebarMenuItem key={item.path}><SidebarMenuButton render={<NavLink to={item.path}/>} isActive={isActive} tooltip={item.label} className="h-9"><item.icon/><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-2 px-2 pb-3">
          <SidebarMenu>
            {can('settings') && <SidebarMenuItem><SidebarMenuButton render={<NavLink to="/settings"/>} isActive={location.pathname.startsWith('/settings')} tooltip="Settings" className="h-9"><Settings/><span>Settings</span></SidebarMenuButton></SidebarMenuItem>}
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="h-12"/>}>
                  <Avatar className="size-7 rounded-md"><AvatarFallback className="rounded-md bg-sidebar-accent text-xs">{user?.name.split(' ').map((part) => part[0]).join('').slice(0,2)}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden"><span className="block truncate text-sm font-medium">{user?.name}</span><span className="block truncate text-xs text-sidebar-foreground/60">{user?.email}</span></span>
                  <ChevronDown className="size-4 group-data-[collapsible=icon]:hidden"/>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                    <DropdownMenuSeparator/>
                    {can('settings') && <DropdownMenuItem onClick={() => navigate('/settings')}><Settings/> Account settings</DropdownMenuItem>}
                    <DropdownMenuItem onClick={() => void logout()}><LogOut/> Sign out</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail/>
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <SidebarTrigger/>
          <div className="hidden items-center gap-2 text-sm sm:flex"><span className="text-muted-foreground">{brand?.name}</span><span className="text-muted-foreground/40">/</span><span className="font-medium">{active?.label ?? 'Workspace'}</span></div>
          <button onClick={() => setSearchOpen(true)} className="mx-auto flex h-8 min-w-0 flex-1 max-w-lg items-center gap-2 rounded-lg border bg-card px-3 text-left text-sm text-muted-foreground shadow-none outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"><Search className="size-4 shrink-0"/><span className="truncate">Search conversations, contacts, campaigns…</span><kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 text-[0.65rem] sm:inline">⌘ K</kbd></button>
          <DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Notifications"/>}><Bell/>{notifications.data?.alerts.length ? <span className="absolute mt-[-18px] ml-[18px] size-2 rounded-full bg-primary"/> : null}</DropdownMenuTrigger><DropdownMenuContent align="end" className="w-80"><DropdownMenuGroup><DropdownMenuLabel>Notifications</DropdownMenuLabel><DropdownMenuSeparator/>{notifications.data?.alerts.map((alert) => <DropdownMenuItem key={alert.id} className="items-start py-2" onClick={() => navigate('/overview')}><span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500"/><span><strong className="block text-sm">{alert.title}</strong><span className="block text-xs text-muted-foreground">{alert.detail}</span></span></DropdownMenuItem>)}{!notifications.data?.alerts.length && <DropdownMenuItem disabled>No active alerts</DropdownMenuItem>}</DropdownMenuGroup><DropdownMenuSeparator/><DropdownMenuItem onClick={() => navigate('/campaigns')}>View delivery activity</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          {can('campaigns') && <Button size="sm" onClick={() => navigate('/campaigns/new')} className="hidden sm:inline-flex"><Plus/> Create campaign</Button>}
        </header>
        <main className="page-gutter min-w-0"><Outlet/></main>
      </SidebarInset>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="top-[28%] max-w-xl p-0">
          <DialogHeader className="sr-only"><DialogTitle>Search Sendry</DialogTitle><DialogDescription>Open a product area or action.</DialogDescription></DialogHeader>
          <Command><CommandInput placeholder="Search Sendry…"/><CommandList><CommandEmpty>No results found.</CommandEmpty><CommandGroup heading="Navigate">{availableNavigation.map((item) => <CommandItem key={item.path} onSelect={() => { navigate(item.path); setSearchOpen(false) }}><item.icon/>{item.label}</CommandItem>)}</CommandGroup><CommandGroup heading="Actions">{can('campaigns') && <CommandItem onSelect={() => { navigate('/campaigns/new'); setSearchOpen(false) }}><Sparkles/>Create campaign</CommandItem>}{can('automations') && <CommandItem onSelect={() => { navigate('/automations'); setSearchOpen(false) }}><Bot/>Build automation</CommandItem>}{can('lists') && <CommandItem onSelect={() => { navigate('/audiences'); setSearchOpen(false) }}><ListFilter/>Explore audiences</CommandItem>}</CommandGroup></CommandList></Command>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  )
}
