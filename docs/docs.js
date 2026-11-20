(() => {
  const root = document.documentElement
  const versionUrl = root.dataset.versionUrl || 'version.json'
  const badges = document.querySelectorAll('[data-rolodex-version]')

  const fill = (version) => {
    badges.forEach((el) => {
      el.textContent = `v${version}`
      if (el.tagName === 'A' && !el.getAttribute('href')) {
        el.setAttribute('href', 'https://github.com/Rolodex-PRM/rolodex/releases')
      }
    })
  }

  if (!badges.length) return

  fetch(versionUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`version fetch ${response.status}`)
      return response.json()
    })
    .then((data) => {
      if (data?.version) fill(String(data.version))
    })
    .catch(() => {
      badges.forEach((el) => {
        el.hidden = true
      })
    })
})()
