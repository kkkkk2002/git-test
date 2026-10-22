import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertWeixinApiBaseUrl } from '../scripts/weixin-build-config.mjs'
import { checkWeixinBuild } from '../scripts/check-weixin-build.mjs'

test('微信发布拒绝缺失、非 HTTPS、本机及示例网关', () => {
  for (const value of ['', '/api/v1', 'http://api.hufe.edu.cn', 'https://localhost', 'https://127.0.0.1',
    'https://[::1]', 'https://api.example.hufe.edu.cn', 'https://example.com', 'https://api.invalid',
    'https://user:password@api.hufe.edu.cn', 'https://api.hufe.edu.cn/?token=x', 'https://api.hufe.edu.cn/#hash']) {
    assert.throws(() => assertWeixinApiBaseUrl(value), /HTTPS/)
  }
  assert.doesNotThrow(() => assertWeixinApiBaseUrl('https://api.hufe.edu.cn/api/v1'))
})

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hufe-weixin-build-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const write = (file, value) => {
    const target = path.join(directory, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, typeof value === 'object' ? JSON.stringify(value) : value)
  }
  write('app.json', { pages: ['pages/home/index'], lazyCodeLoading: 'requiredComponents', tabBar: { list: [
    { pagePath: 'pages/home/index', iconPath: 'static/home.png', selectedIconPath: 'static/home.png' }
  ] } })
  write('project.config.json', { appid: 'wx0123456789abcdef', miniprogramRoot: './', setting: { urlCheck: true, disableSWC: true, swc: false } })
  for (const extension of ['js', 'wxml', 'wxss']) write(`pages/home/index.${extension}`, '')
  write('pages/home/index.json', {})
  write('static/home.png', 'fixture')
  return { directory, write }
}

test('微信产物检查能发现页面、组件和 tab 图标缺失', (t) => {
  const { directory, write } = fixture(t)
  assert.equal(checkWeixinBuild(directory).pages, 1)
  write('pages/home/index.json', { usingComponents: { detail: '../../components/detail' } })
  assert.throws(() => checkWeixinBuild(directory), /组件产物缺失/)
  write('components/detail.js', '')
  write('components/detail.wxml', '')
  write('components/detail.json', {})
  assert.equal(checkWeixinBuild(directory).pages, 1)
  fs.unlinkSync(path.join(directory, 'pages/home/index.wxml'))
  assert.throws(() => checkWeixinBuild(directory), /页面产物缺失/)
  write('pages/home/index.wxml', '')
  fs.unlinkSync(path.join(directory, 'static/home.png'))
  assert.throws(() => checkWeixinBuild(directory), /图标缺失/)
})

test('微信产物检查拒绝关闭域名校验和主包超限', (t) => {
  const { directory, write } = fixture(t)
  write('static/oversized.bin', 'x'.repeat(2 * 1024 * 1024))
  assert.throws(() => checkWeixinBuild(directory), /超过 2 MiB/)
  write('project.config.json', { appid: 'wx0123456789abcdef', setting: { urlCheck: false } })
  assert.throws(() => checkWeixinBuild(directory), /合法域名校验/)
})
