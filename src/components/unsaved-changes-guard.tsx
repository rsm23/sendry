import { useCallback, useEffect } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function UnsavedChangesGuard({ when, onBlockedChange }: { when: boolean; onBlockedChange?: (blocked: boolean) => void }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && (
    currentLocation.pathname !== nextLocation.pathname
    || currentLocation.search !== nextLocation.search
    || currentLocation.hash !== nextLocation.hash
  ))

  useBeforeUnload(useCallback((event) => {
    if (!when) return
    event.preventDefault()
    event.returnValue = ''
  }, [when]))

  useEffect(() => {
    if (!when && blocker.state === 'blocked') blocker.proceed()
  }, [blocker, when])

  useEffect(() => {
    onBlockedChange?.(blocker.state === 'blocked')
  }, [blocker.state, onBlockedChange])

  const stay = () => {
    if (blocker.state === 'blocked') blocker.reset()
  }
  const leave = () => {
    if (blocker.state === 'blocked') blocker.proceed()
  }

  return (
    <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) stay() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 grid size-10 place-items-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </span>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>You have unsaved changes. If you leave now, they will be lost.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={stay}>Keep editing</Button>
          <Button type="button" variant="destructive" onClick={leave}>Leave without saving</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
