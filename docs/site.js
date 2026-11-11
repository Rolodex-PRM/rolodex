(() => {
  const header = document.querySelector('.site-header')
  const toggle = document.querySelector('.menu-toggle')
  const links = document.querySelector('#nav-links')
  const install = document.querySelector('[data-install]')

  const onScroll = () => {
    if (!header) return
    header.classList.toggle('is-scrolled', window.scrollY > 8)
  }

  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const open = links.classList.toggle('is-open')
      toggle.setAttribute('aria-expanded', String(open))
    })

    links.querySelectorAll('a').forEach((anchor) => {
      anchor.addEventListener('click', () => {
        links.classList.remove('is-open')
        toggle.setAttribute('aria-expanded', 'false')
      })
    })
  }

  if (!install) return

  const tabs = [...install.querySelectorAll('[role="tab"]')]
  const panels = Object.fromEntries(
    tabs.map((tab) => [tab.dataset.tab, install.querySelector(`#panel-${tab.dataset.tab}`)]),
  )
  const copyBtn = install.querySelector('[data-copy]')

  const activePanel = () => {
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')
    return panels[selected?.dataset.tab || 'run']
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab
      tabs.forEach((other) => other.setAttribute('aria-selected', String(other === tab)))
      Object.entries(panels).forEach(([name, panel]) => {
        if (!panel) return
        panel.hidden = name !== key
      })
    })
  })

  copyBtn?.addEventListener('click', async () => {
    const panel = activePanel()
    const text = panel?.textContent?.trim() || ''
    try {
      await navigator.clipboard.writeText(text)
      copyBtn.textContent = 'Copied'
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy'
      }, 1400)
    } catch {
      copyBtn.textContent = 'Select text'
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy'
      }, 1600)
    }
  })
})()
