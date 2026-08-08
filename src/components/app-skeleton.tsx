import { Skeleton } from '@/components/ui/skeleton'

export function AppSkeleton() {
  return <div className="flex min-h-svh bg-background"><div className="hidden w-64 bg-sidebar md:block"/><div className="flex-1 p-8"><Skeleton className="mb-8 h-10 w-56"/><div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28"/>)}</div><Skeleton className="mt-6 h-[28rem]"/></div></div>
}
