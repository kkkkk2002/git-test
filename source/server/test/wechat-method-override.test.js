import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

const override = { 'X-HTTP-Method-Override': 'PATCH' }
const origin = 'https://client.example.test'

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-wechat-method-'))
  const contentService = {
    init: async () => {}, startScheduler() {}, stopScheduler() {},
    status: () => ({}), home: () => ({}), list: () => ({ items: [] }), get: async () => null
  }
  const config = createConfig({
    env: 'test', dataFile: path.join(dir, 'data.json'), mediaDir: path.join(dir, 'media'),
    dataHashSecret: 'wechat-method-tests-only', corsOrigins: [origin]
  })
  const app = await buildApp({ config, logger: false, contentService, scheduleContent: false })
  t.after(async () => { await app.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const users = {}, headers = {}
  for (const name of ['alice', 'bob']) {
    users[name] = await app.services.accounts.register({
      schoolSubject: `wechat-${name}`, name: `测试${name}`, department: '测试学院',
      personType: 'student', verificationSource: 'school-registration-check'
    }, { username: `wechat_${name}`, password: `Only-QA-${name}-2026!` })
    headers[name] = { authorization: `Bearer ${app.services.sessions.issueAccess(users[name]).accessToken}` }
  }
  const patch = (who, url, payload, extra = {}) => app.inject({
    method: 'POST', url, payload, headers: { ...headers[who], ...override, ...extra }
  })
  return { app, users, headers, patch }
}

test('微信 POST 兼容资料 PATCH，保留身份、字段校验、版本冲突和审计', async t => {
  const { app, users, headers, patch } = await fixture(t)
  const url = '/api/v1/me/profile'
  const payload = { revision: 0, fields: { email: 'wechat@example.test' } }
  assert.equal((await patch(null, url, payload)).statusCode, 401)
  assert.equal((await patch('alice', url, { revision: 0, fields: { isAdmin: true } })).statusCode, 400)
  const saved = await patch('alice', url, payload)
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal(saved.json().data.fields.email, 'wechat@example.test')
  assert.equal((await patch('alice', url, payload)).statusCode, 409)
  const other = await app.inject({ url, headers: headers.bob })
  assert.notEqual(other.json().data.fields.email, 'wechat@example.test')
  const native = await app.inject({ method: 'PATCH', url, headers: headers.alice,
    payload: { revision: saved.json().data.revision, fields: { email: 'native@example.test' } } })
  assert.equal(native.statusCode, 200, native.body)
  const logs = await app.services.audit.list({ actor: users.alice.id })
  assert.ok(logs.items.some(row => row.trace.route === url && row.trace.method === 'PATCH' && row.trace.result === 'success'))
})

test('微信群资料更新仍校验群管理权限与后台权限', async t => {
  const { app, users, patch } = await fixture(t)
  const group = await app.services.chat.create(users.alice.id, {
    type: 'group', title: '原群名', memberIds: [users.bob.id]
  })
  const url = `/api/v1/chat/conversations/${group.id}`
  const body = { title: '微信新群名', revision: group.groupRevision }
  assert.equal((await patch('bob', url, body)).statusCode, 403)
  const saved = await patch('alice', url, body)
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal(saved.json().data.title, '微信新群名')
  const admin = await patch('alice', `/api/v1/admin/chat/conversations/${group.id}`, {
    status: 'paused', revision: 0, reason: '越权尝试'
  })
  assert.equal(admin.statusCode, 403)
})

test('仅 POST + PATCH 可以改义，CORS 仍限制来源并允许兼容头预检', async t => {
  const { app, headers, patch } = await fixture(t)
  const url = '/api/v1/me/profile'
  for (const value of ['DELETE', 'PUT', 'GET', 'patch', 'PATCH, DELETE', ['PATCH', 'PATCH']]) {
    const response = await app.inject({ method: 'POST', url, headers: {
      ...headers.alice, 'x-http-method-override': value
    }, payload: { revision: 0, fields: { email: 'invalid@example.test' } } })
    assert.equal(response.statusCode, 404, String(value))
  }
  const get = await app.inject({ method: 'GET', url, headers: { ...headers.alice, ...override } })
  assert.equal(get.statusCode, 200)
  assert.equal(get.json().data.revision, 0)
  const preflight = await app.inject({ method: 'OPTIONS', url, headers: {
    origin, 'access-control-request-method': 'POST',
    'access-control-request-headers': 'authorization,content-type,x-http-method-override'
  } })
  assert.equal(preflight.statusCode, 204)
  assert.equal(preflight.headers['access-control-allow-origin'], origin)
  assert.match(preflight.headers['access-control-allow-headers'], /x-http-method-override/)
  const denied = await patch('alice', url, { revision: 0, fields: {} }, { origin: 'https://untrusted.invalid' })
  assert.equal(denied.statusCode, 403)
  assert.equal(denied.json().code, 'CORS_ORIGIN_DENIED')
})
