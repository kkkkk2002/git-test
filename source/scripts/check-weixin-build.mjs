import fs from 'node:fs'
import path from 'node:path'

const PACKAGE_LIMIT = 2 * 1024 * 1024

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(file) : [file]
  })
}

/** 对实际编译产物验收，避免源码配置正确但开发者工具仍缺页、缺组件或超包。 */
export function checkWeixinBuild(directory) {
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
  const app = readJson('app.json')
  const project = readJson('project.config.json')
  if (!/^wx[0-9a-f]{16}$/.test(project.appid || '')) throw new Error('微信 AppID 无效')
  if (project.setting?.urlCheck !== true) throw new Error('微信产物必须保留合法域名校验')
  if (project.setting?.disableSWC !== true || project.setting?.swc !== false || project.miniprogramRoot !== './') {
    throw new Error('微信开发者工具兼容配置未生效')
  }
  if (app.lazyCodeLoading !== 'requiredComponents') throw new Error('微信组件按需加载配置未生效')
  const packages = app.subPackages || app.subpackages || []
  const pages = [...app.pages, ...packages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`))]
  for (const page of pages) {
    for (const extension of ['.js', '.json', '.wxml']) {
      if (!fs.existsSync(path.join(directory, page + extension))) throw new Error(`微信页面产物缺失：${page}${extension}`)
    }
  }
  for (const tab of app.tabBar?.list || []) {
    if (!app.pages.includes(tab.pagePath)) throw new Error(`tabBar 页面必须在主包：${tab.pagePath}`)
    for (const key of ['iconPath', 'selectedIconPath']) {
      if (!fs.existsSync(path.join(directory, tab[key] || ''))) throw new Error(`tabBar 图标缺失：${tab[key]}`)
    }
  }
  const files = filesUnder(directory)
  checkComponents(directory, files, readJson)
  const sizes = new Map([['主包', 0], ...packages.map((pkg) => [pkg.root, 0])])
  for (const file of files) {
    const relative = path.relative(directory, file).split(path.sep).join('/')
    const owner = packages.find((pkg) => relative.startsWith(`${pkg.root}/`))?.root || '主包'
    sizes.set(owner, sizes.get(owner) + fs.statSync(file).size)
  }
  for (const [name, bytes] of sizes) {
    if (bytes > PACKAGE_LIMIT) throw new Error(`微信${name}超过 2 MiB：${bytes} 字节，请拆分分包或缩减资源`)
  }
  return { pages: pages.length, mainBytes: sizes.get('主包') }
}

function checkComponents(directory, files, readJson) {
  for (const file of files.filter((file) => file.endsWith('.json'))) {
    const json = readJson(path.relative(directory, file))
    for (const component of Object.values(json.usingComponents || {})) {
      if (component.startsWith('plugin://')) continue
      const target = component.startsWith('/') ? path.join(directory, component) : path.resolve(path.dirname(file), component)
      for (const extension of ['.js', '.json', '.wxml']) {
        if (!fs.existsSync(target + extension)) throw new Error(`微信组件产物缺失：${component}${extension}（${path.relative(directory, file)}）`)
      }
    }
  }
}
