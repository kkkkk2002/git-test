import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

// 回归用例：后台通用编辑接口不得直写 submission 的 status。
//
// 背景：updateAdmin 的 submission 分支曾把 status 放进可直接写入的顶层字段，
// 使 /api/v1/admin/business/<提交类资源>/:id 的 PATCH 能绕过 actAdmin 的动作状态机
// （actionAllowed），并架空公益证书的唯一签发出口 issue_certificate
// （service.js 中 giving-intent 的 GIVING_CERTIFICATE_ACTION_REQUIRED 守卫只在 /actions 生效）。
// 本用例固定「状态只能经 /actions 变更」这一约束。

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status,
    home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null, refresh: async () => status
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-status-guard-'))
  const config = createConfig({
    env: 'test', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'status-guard-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  await app.services.accounts.register({
    schoolSubject: 'status-guard-admin', name: '状态守卫管理员', personType: 'staff', department: '信息中心',
    verificationSource: 'school-registration-check', isAdmin: true
  }, { username: 'status_guard_admin', password: 'StrongAdmin!2026' })
  await app.services.accounts.register({
    schoolSubject: 'status-guard-user', name: '状态守卫用户', personType: 'student', department: '财政金融学院',
    verificationSource: 'school-registration-check', isAdmin: false
  }, { username: 'status_guard_user', password: 'StrongUser!2026' })

  const login = async (username, password) => (await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username, password }
  })).json().data.accessToken
  return {
    app,
    adminToken: await login('status_guard_admin', 'StrongAdmin!2026'),
    userToken: await login('status_guard_user', 'StrongUser!2026')
  }
}

async function createVisitSubmission(app, userToken) {
  const created = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: { authorization: `Bearer ${userToken}` },
    payload: { type: 'campus-visit', payload: { visitDate: '2026-10-01', date: '2026-10-01' } }
  })
  assert.equal(created.statusCode, 201, created.body)
  return created.json().data
}

test('后台通用编辑接口不能直写 submission 状态，必须走动作状态机', async (t) => {
  const { app, adminToken, userToken } = await fixture(t)
  const submission = await createVisitSubmission(app, userToken)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }

  // 直写 status 必须被明确拒绝，且给出受保护字段错误码
  const bypass = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/campus-visits/${submission.id}`, headers: adminHeaders,
    payload: { status: 'completed', expectedRevision: submission.revision }
  })
  assert.equal(bypass.statusCode, 400, bypass.body)
  assert.equal(bypass.json().code, 'BUSINESS_PROTECTED_FIELD')

  // 记录状态不得因被拒绝的请求而变化
  const detail = await app.inject({ method: 'GET', url: `/api/v1/admin/business/campus-visits/${submission.id}`, headers: adminHeaders })
  assert.equal(detail.statusCode, 200, detail.body)
  assert.equal(detail.json().data.status, submission.status)
  assert.equal(detail.json().data.revision, submission.revision)

  // 非状态字段仍可正常编辑，修复不得误伤正常编辑能力
  const legit = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/campus-visits/${submission.id}`, headers: adminHeaders,
    payload: { adminReply: '欢迎回母校！', adminNote: '内部备注', expectedRevision: submission.revision }
  })
  assert.equal(legit.statusCode, 200, legit.body)
  assert.equal(legit.json().data.revision, submission.revision + 1)

  // 状态仍可经 /actions 正常流转
  const acted = await app.inject({
    method: 'POST', url: `/api/v1/admin/business/campus-visits/${submission.id}/actions`, headers: adminHeaders,
    payload: { action: 'approve', expectedRevision: legit.json().data.revision }
  })
  assert.equal(acted.statusCode, 200, acted.body)
  assert.equal(acted.json().data.status, 'approved')
})

test('敏感字段 status 与内部字段 adminNote 不得经通用编辑接口写入 payload', async (t) => {
  const { app, adminToken, userToken } = await fixture(t)
  const submission = await createVisitSubmission(app, userToken)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }

  const attempt = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/business/campus-visits/${submission.id}`, headers: adminHeaders,
    payload: { payload: { status: 'approved', revision: 999 }, expectedRevision: submission.revision }
  })
  assert.equal(attempt.statusCode, 200, attempt.body)

  const detail = await app.inject({ method: 'GET', url: `/api/v1/admin/business/campus-visits/${submission.id}`, headers: adminHeaders })
  assert.equal(detail.json().data.status, submission.status)
  assert.notEqual(detail.json().data.revision, 999)
})
