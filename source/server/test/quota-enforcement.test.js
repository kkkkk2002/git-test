import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'

// T04 补充覆盖：名额与重复提交。
//
// 对应任务要求「覆盖资源CRUD、报名/申请状态、名额与重复提交」。
// 本文件补齐三处配额路径的显式用例，其中 volunteers 配额此前未被服务端执行
// （quota 字段可被后台设置却从不校验），本用例即为该缺陷的回归保护。

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status,
    home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null, refresh: async () => status
  }
}

async function fixture(t, names) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-quota-'))
  const config = createConfig({
    env: 'test', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'quota-test-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  await app.services.accounts.register({
    schoolSubject: 'quota-admin', name: '名额管理员', personType: 'staff', department: '信息中心',
    verificationSource: 'school-registration-check', isAdmin: true
  }, { username: 'quota_admin', password: 'QuotaAdmin!2026' })

  const applicants = []
  for (const name of names) {
    await app.services.accounts.register({
      schoolSubject: `quota-${name}`, name: `申请人${name}`, personType: 'student', department: '财政金融学院',
      verificationSource: 'school-registration-check', isAdmin: false
    }, { username: `quota_${name}`, password: 'QuotaUser!2026' })
    const token = (await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { username: `quota_${name}`, password: 'QuotaUser!2026' }
    })).json().data.accessToken
    applicants.push({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })
  }

  const adminToken = (await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username: 'quota_admin', password: 'QuotaAdmin!2026' }
  })).json().data.accessToken
  return { app, admin: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, applicants }
}

async function createAndPublish(app, admin, resource, payload) {
  const created = await app.inject({ method: 'POST', url: `/api/v1/admin/business/${resource}`, headers: admin, payload })
  assert.equal(created.statusCode, 201, created.body)
  const record = created.json().data
  const published = await app.inject({
    method: 'POST', url: `/api/v1/admin/business/${resource}/${record.id}/actions`, headers: admin,
    payload: { action: 'publish', expectedRevision: record.revision }
  })
  assert.equal(published.statusCode, 200, published.body)
  return published.json().data
}

test('志愿项目名额：达到配额后拒绝新的申请，取消申请可释放名额', async (t) => {
  const { app, admin, applicants } = await fixture(t, ['one', 'two'])
  const project = await createAndPublish(app, admin, 'volunteers', {
    projectTitle: '名额回归志愿项目', quota: 1, summary: '用于验证志愿项目名额'
  })

  const first = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[0],
    payload: { type: 'volunteer-application', resourceId: project.id, payload: { volunteerName: '申请人one' } }
  })
  assert.equal(first.statusCode, 201, first.body)

  const second = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[1],
    payload: { type: 'volunteer-application', resourceId: project.id, payload: { volunteerName: '申请人two' } }
  })
  assert.equal(second.statusCode, 409, second.body)
  assert.equal(second.json().code, 'VOLUNTEER_QUOTA_FULL')

  // 同一用户重复申请同样被去重拒绝
  const again = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[0],
    payload: { type: 'volunteer-application', resourceId: project.id, payload: { volunteerName: '申请人one' } }
  })
  assert.equal(again.statusCode, 409, again.body)
  assert.equal(again.json().code, 'SUBMISSION_ALREADY_EXISTS')

  // 取消后名额释放，第二人可申请
  const cancelled = await app.inject({
    method: 'PATCH', url: `/api/v1/business/me/submissions/${first.json().data.id}/cancel`,
    headers: applicants[0], payload: {}
  })
  assert.equal(cancelled.statusCode, 200, cancelled.body)
  const retry = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[1],
    payload: { type: 'volunteer-application', resourceId: project.id, payload: { volunteerName: '申请人two' } }
  })
  assert.equal(retry.statusCode, 201, retry.body)
})

test('权益领取名额：达到配额后拒绝领取，且同一权益不可重复领取', async (t) => {
  const { app, admin, applicants } = await fixture(t, ['one', 'two'])
  const benefit = await createAndPublish(app, admin, 'alumni-benefits', {
    title: '名额回归权益', category: '校友权益', provider: '校友办', audience: 'all', value: '测试权益',
    quota: 1, startAt: '2026-09-01T00:00:00.000+08:00', endAt: '2026-12-31T23:59:59.999+08:00',
    claimInstructions: '凭实名账号到校友办服务点核销。'
  })

  const first = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[0],
    payload: { type: 'benefit-claim', resourceId: benefit.id, payload: {} }
  })
  assert.equal(first.statusCode, 201, first.body)

  const repeat = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[0],
    payload: { type: 'benefit-claim', resourceId: benefit.id, payload: {} }
  })
  assert.equal(repeat.statusCode, 409, repeat.body)
  assert.equal(repeat.json().code, 'SUBMISSION_ALREADY_EXISTS')

  const second = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[1],
    payload: { type: 'benefit-claim', resourceId: benefit.id, payload: {} }
  })
  assert.equal(second.statusCode, 409, second.body)
  assert.equal(second.json().code, 'BENEFIT_CLAIM_FULL')
})

test('活动报名名额：达到配额后拒绝报名，重复报名被去重拒绝', async (t) => {
  const { app, admin, applicants } = await fixture(t, ['one', 'two'])
  const activity = await createAndPublish(app, admin, 'activities', {
    title: '名额回归活动', category: '校友活动', organizer: '校友办', venue: '校内',
    startAt: '2026-12-01T09:00:00.000+08:00', description: '用于验证活动名额', quota: 1
  })

  const first = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[0],
    payload: { type: 'event-registration', resourceId: activity.id, payload: {} }
  })
  assert.equal(first.statusCode, 201, first.body)

  const repeat = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[0],
    payload: { type: 'event-registration', resourceId: activity.id, payload: {} }
  })
  assert.equal(repeat.statusCode, 409, repeat.body)
  assert.equal(repeat.json().code, 'SUBMISSION_ALREADY_EXISTS')

  const second = await app.inject({
    method: 'POST', url: '/api/v1/business/submissions', headers: applicants[1],
    payload: { type: 'event-registration', resourceId: activity.id, payload: {} }
  })
  assert.equal(second.statusCode, 409, second.body)
  assert.equal(second.json().code, 'EVENT_REGISTRATION_FULL')
})
