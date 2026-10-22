import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildApp } from '../src/app.js'
import { createConfig } from '../src/config.js'
import { hashPassword, verifyPassword } from '../src/auth/crypto.js'
import { trustedProxyPolicy } from '../src/audit/metadata.js'

// T09 专项复核的可执行复现用例，对应任务要求：
//   「专项复核可推导初始口令、代理限流、越权、敏感字段和关闭模块绕过；
//     提供复现及修复/有效隔离证据。」
// 每条用例都是「先复现风险路径，再断言被有效隔离」。

function contentStub() {
  const status = { stale: false, itemCount: 0, sourceStatuses: [] }
  return {
    init: async () => {}, startScheduler() {}, stopScheduler() {}, status: () => status,
    home: () => ({ status, sections: {} }), list: () => ({ items: [], total: 0, page: 1, pageSize: 12, status }),
    get: async () => null, refresh: async () => status
  }
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hufe-sec-review-'))
  const config = createConfig({
    env: 'test', dataFile: path.join(directory, 'data.json'), dataHashSecret: 'security-review-secret',
    content: { cacheFile: path.join(directory, 'content.json') }
  })
  const app = await buildApp({ config, logger: false, refreshContent: false, scheduleContent: false, contentService: contentStub() })
  t.after(async () => { await app.close(); await fs.rm(directory, { recursive: true, force: true }) })

  await app.services.accounts.register({
    schoolSubject: 'sec-admin', name: '安全复核管理员', personType: 'staff', department: '信息中心',
    verificationSource: 'school-registration-check', isAdmin: true
  }, { username: 'sec_admin', password: 'StrongAdmin!2026' })
  await app.services.accounts.register({
    schoolSubject: 'sec-user', name: '安全复核用户', personType: 'student', department: '财政金融学院',
    verificationSource: 'school-registration-check', isAdmin: false
  }, { username: 'sec_user', password: 'StrongUser!2026' })

  const login = async (username, password) => (await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username, password }
  })).json().data.accessToken
  return {
    app,
    adminToken: await login('sec_admin', 'StrongAdmin!2026'),
    userToken: await login('sec_user', 'StrongUser!2026')
  }
}

// ─────────────────────────────────────────────────────────────
// 一、代理限流
// ─────────────────────────────────────────────────────────────

test('代理限流：伪造 X-Forwarded-For 无法绕过按 IP 的登录限频', async (t) => {
  const { app } = await fixture(t)
  // 登录路由配置为 15 次/分钟；轮换 XFF 试图把每次请求伪装成不同来源 IP。
  let firstLimitedAt = 0
  for (let i = 1; i <= 20; i += 1) {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      headers: { 'x-forwarded-for': `203.0.113.${i}` },
      payload: { username: 'sec_admin', password: 'wrong-password-for-limit-test' }
    })
    if (response.statusCode === 429 && !firstLimitedAt) firstLimitedAt = i
  }
  assert.ok(firstLimitedAt > 0, '轮换 X-Forwarded-For 后必须仍然触发限流（信任来源时才是缺陷）')
  assert.ok(firstLimitedAt <= 16, `应在第 16 次前后开始限流，实际第 ${firstLimitedAt} 次`)
  const limited = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    headers: { 'x-forwarded-for': '203.0.113.250' },
    payload: { username: 'sec_admin', password: 'wrong-password-for-limit-test' }
  })
  assert.equal(limited.statusCode, 429)
  assert.equal(limited.json().code, 'RATE_LIMITED')
})

test('代理限流：无法把代理策略配置成信任所有来源', () => {
  // 默认关闭
  assert.equal(trustedProxyPolicy(false, ''), false)
  assert.equal(trustedProxyPolicy(undefined, ''), false)
  // 开启但未给出可信代理 → 直接拒绝，不允许“信任全部”
  assert.throws(() => trustedProxyPolicy(true, ''), /不能信任所有来源/)
  // 全网段（/0）被拒绝
  assert.throws(() => trustedProxyPolicy(true, '0.0.0.0/0'), /具体代理 IP 或非全网 CIDR/)
  assert.throws(() => trustedProxyPolicy(true, '::/0'), /具体代理 IP 或非全网 CIDR/)
  // 非法条目被拒绝
  assert.throws(() => trustedProxyPolicy(true, 'not-an-ip'), /具体代理 IP 或非全网 CIDR/)
  assert.throws(() => trustedProxyPolicy(true, '127.0.0.1/33'), /具体代理 IP 或非全网 CIDR/)
  // 合法的具体代理被接受
  assert.deepEqual(trustedProxyPolicy(true, '127.0.0.1/32,::1/128'), ['127.0.0.1/32', '::1/128'])
})

// ─────────────────────────────────────────────────────────────
// 二、可推导初始口令
// ─────────────────────────────────────────────────────────────

test('初始口令：同一口令两次哈希不同（随机盐），且校验恒定正确', async () => {
  const first = await hashPassword('SamePassword123')
  const second = await hashPassword('SamePassword123')
  assert.notEqual(first, second, '相同口令必须产生不同哈希（每口令随机盐）')
  assert.match(first, /^scrypt\$\d+\$\d+\$\d+\$/)
  assert.equal(await verifyPassword('SamePassword123', first), true)
  assert.equal(await verifyPassword('SamePassword123', second), true)
  assert.equal(await verifyPassword('SamePassword124', first), false)
  // 结构损坏的哈希不得被接受
  for (const broken of ['', 'plain', 'scrypt$16384$8$1$onlysalt', 'md5$1$1$1$a$b']) {
    assert.equal(await verifyPassword('SamePassword123', broken), false, `不应接受损坏哈希: ${broken}`)
  }
})

test('初始口令：管理员为他账号重置后强制改密，改密前管理权限被拒绝', async (t) => {
  const { app, adminToken } = await fixture(t)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }

  // 再建一个管理员作为被重置目标
  const target = await app.services.accounts.register({
    schoolSubject: 'sec-admin-two', name: '第二管理员', personType: 'staff', department: '信息中心',
    verificationSource: 'school-registration-check', isAdmin: true
  }, { username: 'sec_admin_two', password: 'OriginalAdmin!2026' })

  // 目标账号在重置前可正常使用管理接口
  const beforeToken = (await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username: 'sec_admin_two', password: 'OriginalAdmin!2026' }
  })).json().data.accessToken
  assert.equal((await app.inject({
    method: 'GET', url: '/api/v1/admin/modules', headers: { authorization: `Bearer ${beforeToken}` }
  })).statusCode, 200)

  // 由另一管理员重置其口令
  const reset = await app.inject({
    method: 'POST', url: `/api/v1/admin/accounts/${target.id}/password`, headers: adminHeaders,
    payload: {
      newPassword: 'ResetByOther!2026', confirmPassword: 'ResetByOther!2026',
      reason: '复核初始口令强制改密策略', expectedRevision: target.revision,
      confirmation: '确认修改该账号密码'
    }
  })
  assert.equal(reset.statusCode, 200, reset.body)
  assert.equal(reset.json().data.mustChangePassword, true, '他人重置必须置为强制改密')

  // 旧会话已被撤销
  assert.equal((await app.inject({
    method: 'GET', url: '/api/v1/admin/modules', headers: { authorization: `Bearer ${beforeToken}` }
  })).statusCode, 401)

  // 用新口令登录后，未改密前不得使用管理权限
  const afterLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username: 'sec_admin_two', password: 'ResetByOther!2026' }
  })
  assert.equal(afterLogin.statusCode, 200, afterLogin.body)
  assert.equal(afterLogin.json().data.user.mustChangePassword, true)
  const afterToken = afterLogin.json().data.accessToken
  const blocked = await app.inject({
    method: 'GET', url: '/api/v1/admin/modules', headers: { authorization: `Bearer ${afterToken}` }
  })
  assert.equal(blocked.statusCode, 403)
  assert.equal(blocked.json().code, 'PASSWORD_CHANGE_REQUIRED')

  // 自助改密后恢复，且旧 token 失效（凭据版本递增）
  const changed = await app.inject({
    method: 'POST', url: '/api/v1/auth/change-password', headers: { authorization: `Bearer ${afterToken}` },
    payload: { currentPassword: 'ResetByOther!2026', newPassword: 'SelfChosen!2026', confirmPassword: 'SelfChosen!2026' }
  })
  assert.equal(changed.statusCode, 200, changed.body)
  const fresh = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { username: 'sec_admin_two', password: 'SelfChosen!2026' }
  })
  assert.equal(fresh.statusCode, 200)
  assert.equal(fresh.json().data.user.mustChangePassword, false)
  assert.equal((await app.inject({
    method: 'GET', url: '/api/v1/admin/modules', headers: { authorization: `Bearer ${fresh.json().data.accessToken}` }
  })).statusCode, 200)
})

// ─────────────────────────────────────────────────────────────
// 三、关闭模块绕过
// ─────────────────────────────────────────────────────────────

test('关闭模块绕过：关闭后多种 URL 变体均无法访问该模块', async (t) => {
  const { app, adminToken } = await fixture(t)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }

  // 基线：关闭前该公开接口可访问
  const baseline = await app.inject({ method: 'GET', url: '/api/v1/business/community-posts' })
  assert.equal(baseline.statusCode, 200, baseline.body)

  // 关闭 community 模块
  const current = (await app.inject({ method: 'GET', url: '/api/v1/admin/modules', headers: adminHeaders })).json().data
  const disabled = await app.inject({
    method: 'PATCH', url: '/api/v1/admin/modules/community', headers: adminHeaders,
    payload: { enabled: false, revision: current.revision, reason: 'T09 关闭模块绕过复核' }
  })
  assert.equal(disabled.statusCode, 200, disabled.body)

  // 逐一尝试绕过
  const variants = [
    '/api/v1/business/community-posts',
    '/api/v1/business/community-posts/',
    '/api/v1/business/community-posts?topic=%E6%A0%A1%E5%9B%AD%E8%AE%B0%E5%BF%86',
    '/api/v1/business//community-posts',
    '/api/v1/business/./community-posts',
    '/api/v1/business/%63ommunity-posts',
    '/api/v1/admin/business/community-posts'
  ]
  for (const url of variants) {
    const response = await app.inject({ method: 'GET', url, headers: adminHeaders })
    assert.notEqual(response.statusCode, 200, `关闭模块后仍可访问：${url} -> ${response.statusCode}`)
  }

  // 发布接口同样被隔离
  const post = await app.inject({
    method: 'POST', url: '/api/v1/business/community-posts',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    payload: { content: '关闭模块后不应成功发布的内容', topic: '校园记忆' }
  })
  assert.notEqual(post.statusCode, 201, `关闭模块后仍可写入：${post.statusCode}`)

  // 重新开启后恢复（证明隔离可逆且未破坏数据）
  const reopened = await app.inject({
    method: 'PATCH', url: '/api/v1/admin/modules/community', headers: adminHeaders,
    payload: { enabled: true, revision: (await app.inject({
      method: 'GET', url: '/api/v1/admin/modules', headers: adminHeaders
    })).json().data.revision, reason: 'T09 复核完成后恢复模块' }
  })
  assert.equal(reopened.statusCode, 200, reopened.body)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/business/community-posts' })).statusCode, 200)
})

// ─────────────────────────────────────────────────────────────
// 四、敏感字段
// ─────────────────────────────────────────────────────────────

test('敏感字段：账号与档案接口不返回口令哈希、身份键与内部备注', async (t) => {
  const { app, adminToken } = await fixture(t)
  const adminHeaders = { authorization: `Bearer ${adminToken}` }

  const forbidden = ['passwordHash', 'schoolSubjectKey', 'studentIdKey', 'idCardKey', 'mustChangePasswordHash', 'passwordSalt']

  const accounts = await app.inject({ method: 'GET', url: '/api/v1/admin/accounts', headers: adminHeaders })
  assert.equal(accounts.statusCode, 200, accounts.body)
  for (const key of forbidden) assert.equal(accounts.body.includes(key), false, `账号列表泄露 ${key}`)

  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: adminHeaders })
  assert.equal(me.statusCode, 200)
  for (const key of forbidden) assert.equal(me.body.includes(key), false, `本人接口泄露 ${key}`)

  // 公开匿名视图不得带出作者身份与内部备注（对应匿名保护）
  const post = await app.inject({
    method: 'POST', url: '/api/v1/business/community-posts',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    payload: { content: '匿名身份隔离复核内容', topic: '校园记忆', anonymous: true }
  })
  if (post.statusCode === 201) {
    const list = await app.inject({ method: 'GET', url: '/api/v1/business/community-posts', headers: adminHeaders })
    assert.equal(list.body.includes('authorAccountId'), false, '匿名视图泄露 authorAccountId')
    assert.equal(list.body.includes('adminNote'), false, '匿名视图泄露 adminNote')
  }
})
