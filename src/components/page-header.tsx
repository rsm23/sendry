import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, description, actions, eyebrowTranslatable = true, titleTranslatable = true }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; eyebrowTranslatable?: boolean; titleTranslatable?: boolean }) {
  return <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0">{eyebrow && <p className="eyebrow mb-2" translate={eyebrowTranslatable ? undefined : 'no'}>{eyebrow}</p>}<h1 className="text-2xl font-semibold sm:text-[1.8rem]" translate={titleTranslatable ? undefined : 'no'}>{title}</h1>{description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}</div>{actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}</header>
}
