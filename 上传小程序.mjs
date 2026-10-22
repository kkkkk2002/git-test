#!/usr/bin/env node
/**
 * 湖财人小程序：生产构建 + 微信上传。
 *
 * WHY：微信开发者工具的 msojocs Linux 移植版在 GUI 与 CLI 两条上传路径上均报
 * `upload Error: Unexpected token '{'`——已确证是移植版自身的模块加载/序列化缺陷
 * （其加载器会把两个文件内容拼接），与本项目代码无关。本脚本改用微信官方
 * miniprogram-ci，完全不经过开发者工具。
 *
 * 用法（在仓库根目录）：
 *   node 上传小程序.mjs --version=1.0.0 --desc="修复登录问题"
 *   node 上传小程序.mjs --version=1.0.0 --dry-run          # 构建 + 全部门禁校验，不上传
 *   node 上传小程序.mjs --version=1.0.0 --robot=2
 *   WX_UPLOAD_KEY=/path/private.key node 上传小程序.mjs --version=1.0.0
 *
 * 安全约束（移植自 ../shangheyan 的同名脚本）：
 *   - `--skip-build` 已禁用：上传与 dry-run 都必须在同一命令中重新执行生产构建，
 *     禁止使用既有 dist，避免把陈旧或改坏的产物发出去
 *   - 上传前强校验构建产物的后端地址与 .env.production 一致、且命中规范锚点，
 *     并拒绝含本机地址（127.0.0.1 / localhost）的产物
 *
 * 前置条件：微信公众平台已把本机出口 IP 加入「小程序代码上传」白名单。
 *
 * @author 樊友尘
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.join(ROOT_DIR, 'source')
const PROJECT_PATH = path.join(SRC_DIR, 'dist', 'build', 'mp-weixin')
const ENV_FILE = path.join(SRC_DIR, '.env.production')
// 以 argv 数组形式调用，不经 shell——即使将来这些参数变为可配置也无注入面
const BUILD_ARGS = ['scripts/run-uni.mjs', 'build', 'mp-weixin']

/**
 * 生产后端地址的规范锚点。
 *
 * 独立于 .env.production 与构建产物的权威来源。只校验两者一致会「自己验自己」失效——
 * 若两侧被同时改坏为同一个错误地址，互相印证仍能通过。生产域名正式变更时必须同步此常量。
 */
const EXPECTED_BASE_URL = 'https://test.wiselaunch.cn'

const fail = (msg) => {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}
const log = (msg) => console.log(`  ${msg}`)

/**
 * 解析参数。支持 --k=v 与 --k v 两种写法。
 *
 * @returns {{version: string, desc: string, dryRun: boolean, robot: number, keyPath: string}}
 */
function parseArgs() {
  const argv = process.argv.slice(2)
  const get = (name, fallback = '') => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`))
    if (eq) return eq.slice(name.length + 3)
    const i = argv.indexOf(`--${name}`)
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1]
    return fallback
  }
  return {
    version: get('version', process.env.WX_UPLOAD_VERSION || ''),
    desc: get('desc', ''),
    dryRun: argv.includes('--dry-run'),
    robot: Number.parseInt(get('robot', '1'), 10),
    keyPath: get('private-key-path', ''),
  }
}

/**
 * 解析 dotenv 风格的 .env 文件。
 *
 * 只支持 key=value（值可带引号），忽略 # 开头的整行注释，**不支持行内注释**——
 * `KEY=v # comment` 中 # 之后会并入值，与 vite 的 dotenv 行为不一致，
 * 因此 .env.production 中不要写行内注释，否则门禁预期值比对会误杀。
 *
 * @param {string} filePath 文件路径
 * @returns {Record<string, string>} 键值对
 */
function parseEnvFile(filePath) {
  const result = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) result[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return result
}

/**
 * 强校验构建产物的后端地址（fail-fast）。
 *
 * 逐条断言：.env.production 存在且命中锚点 → 产物 config/index.js 里的地址与之一致 →
 * 产物不含本机开发地址。dry-run 同样执行（属于产物核验，不属于上传动作）。
 */
function assertProductionBaseUrl() {
  if (!fs.existsSync(ENV_FILE)) fail(`缺少 ${ENV_FILE}，无法确定预期后端地址`)
  const expected = (parseEnvFile(ENV_FILE).VITE_API_BASE_URL || '').replace(/\/+$/, '')
  if (!expected) fail(`${ENV_FILE} 缺少 VITE_API_BASE_URL`)

  if (expected !== EXPECTED_BASE_URL) {
    fail(
      `${ENV_FILE} 的 VITE_API_BASE_URL=${expected} 与规范锚点 ${EXPECTED_BASE_URL} 不一致，禁止上传。\n` +
        `   若后端地址正式变更，需同步 上传小程序.mjs 的 EXPECTED_BASE_URL 常量。`,
    )
  }

  // config/index.js 是产物中后端地址的唯一定义处，其余文件均为变量引用
  const configJs = path.join(PROJECT_PATH, 'config', 'index.js')
  if (!fs.existsSync(configJs)) fail(`构建产物缺少后端配置：${configJs}`)
  const content = fs.readFileSync(configJs, 'utf8')

  if (/127\.0\.0\.1|localhost/.test(content)) {
    fail(`构建产物 ${configJs} 残留本机开发地址（127.0.0.1/localhost），禁止上传`)
  }
  if (!content.includes(expected)) {
    fail(`构建产物 ${configJs} 中未找到预期后端地址 ${expected}，禁止上传`)
  }
  log(`产物后端地址：${expected}（与 ${path.relative(ROOT_DIR, ENV_FILE)} 及规范锚点一致）`)
}

/**
 * 定位上传私钥。私钥等同于发布权限，绝不入库。
 *
 * @param {string} appid 小程序 appid
 * @param {string} override --private-key-path 指定的路径
 * @returns {string} 私钥绝对路径
 */
function resolvePrivateKeyPath(appid, override) {
  const candidates = [
    override,
    process.env.WX_UPLOAD_KEY,
    path.join(ROOT_DIR, `private.${appid}.key`),
    path.join(process.env.HOME || '/root', 'Downloads', `private.${appid}.key`),
  ].filter(Boolean)
  const found = candidates.find((c) => fs.existsSync(c))
  if (!found) {
    fail(
      '未找到微信上传私钥。请用 --private-key-path 或 WX_UPLOAD_KEY 指定，' +
        `或放置 private.${appid}.key。\n   私钥从微信公众平台「开发管理 → 开发设置 → 小程序代码上传」下载。`,
    )
  }
  const resolved = path.resolve(found)
  const mode = fs.statSync(resolved).mode & 0o777
  if (mode & 0o077) log(`⚠ 私钥权限为 ${mode.toString(8)}，建议收紧：chmod 600 "${resolved}"`)
  if (!fs.readFileSync(resolved, 'utf8').includes('PRIVATE KEY')) {
    fail(`私钥格式异常（不是 PEM 私钥）：${resolved}`)
  }
  return resolved
}

async function main() {
  const params = parseArgs()

  // --skip-build 是刻意禁用的：单条命令内重新构建，杜绝上传陈旧产物
  if (process.argv.includes('--skip-build')) {
    fail(
      '--skip-build 已禁用：上传与 dry-run 必须在同一条命令中重新执行生产构建，禁止使用既有 dist。\n' +
        '   仅想校验既有产物而不上传，请直接用 --dry-run。',
    )
  }

  if (!/^\d+\.\d+\.\d+$/.test(params.version)) {
    fail(
      `版本号必须为 x.y.z 格式（微信后台拒绝 2026.04 这类写法）。` +
        `\n   请用 --version=1.0.0 指定。`,
    )
  }
  if (!Number.isInteger(params.robot) || params.robot < 1 || params.robot > 30) {
    fail('--robot 必须是 1 到 30 之间的整数')
  }

  const desc = params.desc || `湖财人小程序上传于 ${new Date().toLocaleString('zh-CN')}`

  console.log('\n湖财人小程序：构建 + 上传')
  console.log(`\n执行生产构建：node ${BUILD_ARGS.join(' ')}`)
  execFileSync('node', BUILD_ARGS, { cwd: SRC_DIR, stdio: 'inherit' })

  if (!fs.existsSync(PROJECT_PATH)) fail(`构建产物不存在：${PROJECT_PATH}`)

  // appid 读自构建产物：它才是真正会上传的那份配置
  const builtConfig = JSON.parse(
    fs.readFileSync(path.join(PROJECT_PATH, 'project.config.json'), 'utf8'),
  )
  const appid = builtConfig.appid
  if (!appid) fail(`构建产物 project.config.json 缺少 appid`)

  assertProductionBaseUrl()

  const privateKeyPath = resolvePrivateKeyPath(appid, params.keyPath)

  const bytes = (() => {
    let n = 0
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else n += fs.statSync(p).size
      }
    }
    walk(PROJECT_PATH)
    return n
  })()
  const mb = (n) => (n / 1024 / 1024).toFixed(2)
  console.log('\n上传参数')
  log(`AppID      : ${appid}`)
  log(`版本号     : ${params.version}`)
  log(`描述       : ${desc}`)
  log(`机器人     : ${params.robot}`)
  log(`私钥       : ${privateKeyPath}`)
  log(`产物体积   : ${mb(bytes)} MB（主包上限 2 MB）`)

  if (bytes > 2 * 1024 * 1024) {
    fail(`产物 ${mb(bytes)} MB 超过微信 2 MB 主包上限，上传必被拒；请在 pages.json 配置 subPackages`)
  }

  if (params.dryRun) {
    console.log('\ndry-run：构建、私钥与产物校验全部通过，未执行上传。\n')
    return
  }

  const ci = require('miniprogram-ci')
  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath: PROJECT_PATH,
    privateKeyPath,
    ignores: ['node_modules/**/*', '**/*.map'],
  })

  console.log('\n上传中…')
  await ci.upload({
    project,
    version: params.version,
    desc,
    robot: params.robot,
    setting: {
      es6: true,
      es7: true,
      minify: builtConfig.setting?.minified !== false,
      minifyJS: true,
      minifyWXML: true,
      minifyWXSS: true,
      autoPrefixWXSS: true,
    },
    // miniprogram-ci 的进度对象结构随版本变化，只在完成态打印，避免刷屏
    onProgressUpdate: (task) => {
      if (task && task._status === 'done' && task._msg) console.log(`  ${task._msg}`)
    },
  })

  console.log('\n✅ 上传成功')
  console.log('   请在微信公众平台「版本管理 → 开发版本」查看。')
  console.log('   该版本为开发版本，未经「提交审核 + 发布」不会面向用户。\n')
}

main().catch((error) => {
  console.error(`\n❌ 上传失败：${error?.message || error}\n`)
  process.exit(1)
})
