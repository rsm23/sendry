const menuToggle = document.querySelector('[data-menu-toggle]')
const navigation = document.querySelector('[data-nav]')

menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true'
  menuToggle.setAttribute('aria-expanded', String(!open))
  navigation?.classList.toggle('is-open', !open)
})

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuToggle?.setAttribute('aria-expanded', 'false')
    navigation.classList.remove('is-open')
  })
})

const revealItems = document.querySelectorAll('[data-reveal]')
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      observer.unobserve(entry.target)
    })
  }, { rootMargin: '0px 0px -7% 0px', threshold: 0.08 })
  revealItems.forEach((item) => observer.observe(item))
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'))
}

const lightbox = document.querySelector('[data-lightbox-dialog]')
const lightboxImage = lightbox?.querySelector('[data-lightbox-image]')
const lightboxCaption = lightbox?.querySelector('[data-lightbox-caption]')
const lightboxClose = lightbox?.querySelector('[data-lightbox-close]')
let lightboxTrigger = null

document.querySelectorAll('[data-lightbox]').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    if (!(lightbox instanceof HTMLDialogElement) || !(lightboxImage instanceof HTMLImageElement)) return
    lightboxTrigger = trigger
    lightboxImage.src = trigger.dataset.lightbox
    lightboxImage.alt = trigger.querySelector('img')?.alt ?? 'Sendry product screenshot'
    if (lightboxCaption) lightboxCaption.textContent = trigger.dataset.caption ?? ''
    lightbox.showModal()
    document.body.classList.add('dialog-open')
  })
})

function closeLightbox() {
  if (!(lightbox instanceof HTMLDialogElement)) return
  lightbox.close()
  document.body.classList.remove('dialog-open')
  lightboxImage?.removeAttribute('src')
  lightboxTrigger?.focus()
}

lightboxClose?.addEventListener('click', closeLightbox)
lightbox?.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox()
})
lightbox?.addEventListener('close', () => document.body.classList.remove('dialog-open'))

const copyButton = document.querySelector('[data-copy-command]')
const copyStatus = document.querySelector('[data-copy-status]')
const command = `git clone https://github.com/rsm23/sendry.git
cd sendry
corepack enable
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev`

copyButton?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(command)
    copyButton.textContent = 'Copied'
    if (copyStatus) copyStatus.innerHTML = 'Command copied. Open <strong>http://localhost:5173</strong> when Sendry starts.'
  } catch {
    copyButton.textContent = 'Select command'
    window.getSelection()?.selectAllChildren(document.querySelector('.command-panel pre'))
  }
  window.setTimeout(() => { copyButton.textContent = 'Copy' }, 2200)
})
