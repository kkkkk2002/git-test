import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { schoolBrand } from '../src/brand.js'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')

test('学校正式图稿本地内置，组合SVG保留PDF路径与字标JPEG且后台镜像一致',async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(root,'assets/brand-sources/manifest.json'),'utf8'))
  assert.equal(schoolBrand.englishName,'Hunan College of Finance and Economics')
  assert.equal(schoolBrand.shortEnglishName,'HUFE')
  // 归档原件（assets/brand-sources/）必须与其清单记录的哈希一致——原件本身不得被改动。
  for(const [type,info] of Object.entries(manifest.sources))assert.equal(sha(await fs.readFile(path.join(root,'assets/brand-sources',info.file))),info.sha256,type)
  // 两个发布目录必须完全一致。
  for(const file of Object.values(manifest.output))assert.deepEqual(await fs.readFile(path.join(root,'static/brand',file)),await fs.readFile(path.join(root,'admin/public/static/brand',file)),file)
  const svg=await fs.readFile(path.join(root,'static/brand',manifest.output.logo),'utf8')
  const embedded=Buffer.from(svg.match(/data:image\/jpeg;base64,([^"']+)/)[1],'base64')
  const shipped=await fs.readFile(path.join(root,'static/brand',manifest.output.wordmark))
  // 交付契约：SVG 内嵌的字标必须与随包发布的 school-wordmark-*.jpg 是同一份字节。
  // 这样图稿只存在一个发布真源，避免两处各自漂移。
  assert.equal(sha(embedded),sha(shipped),'SVG 内嵌字标应与 static/brand 下的字标 jpg 完全一致')
  // 内嵌图为按显示尺寸降采样的版本（显示最大 245px，原图 3766px 过剩约 15 倍）。
  // 此处只断言"确实是原图的缩小版"——原件哈希仍由上面的 sources 校验保护，
  // 保证归档未被篡改；发布件允许降采样以满足微信 2MB 主包上限。
  const original=await fs.readFile(path.join(root,'assets/brand-sources',manifest.sources.wordmark.file))
  assert.ok(embedded.length<original.length,`内嵌字标(${embedded.length}B)应为原图(${original.length}B)的降采样版本`)
  assert.equal(sha(embedded)===manifest.sources.wordmark.sha256,false,'内嵌字标不应与归档原件逐字节相同——若相同说明降采样丢失')
  const crest=await fs.readFile(path.join(root,'static/brand',manifest.output.crest),'utf8')
  const originalPaths=crest.match(/<path\b[^>]*>/g),combinedPaths=svg.match(/<path\b[^>]*>/g)
  assert.ok(originalPaths.length>10);assert.deepEqual(combinedPaths,originalPaths)
  assert.doesNotMatch(svg,/<script|<foreignObject|(?:href|src)=["']https?:/i)
  assert.match(svg,/<rect[^>]+fill="#fff"/)
})

test('前后台显示使用本地品牌配置，英文全称更新但历史HUFE账号键不变',async()=>{
  const config=await fs.readFile(path.join(root,'config/index.js'),'utf8')
  assert.match(config,/officialLogoUrl: schoolBrand.logoUrl/)
  assert.match(config,/authStorageKey: 'hufe_alumni_auth_state'/)
  for(const file of ['admin/src/views/LoginView.vue','admin/src/views/ChangePasswordView.vue','admin/src/layouts/AdminLayout.vue']){
    const source=await fs.readFile(path.join(root,file),'utf8');assert.match(source,/schoolBrand/);assert.doesNotMatch(source,/hufe\.edu\.cn\/images\/logo\.png/)
  }
  assert.doesNotMatch(await fs.readFile(path.join(root,'pages/giving-certificate/index.vue'),'utf8'),/HUNAN UNIVERSITY OF FINANCE AND ECONOMICS/)
})
