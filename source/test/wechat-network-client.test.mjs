import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'

function platformSource(source, platform) {
  const active = [true]
  return source.split('\n').filter(line => {
    const directive = line.match(/^\s*\/\/\s*#(ifdef|ifndef|endif)\s*(.*)$/)
    if (!directive) return active.every(Boolean)
    if (directive[1] === 'endif') active.pop()
    else {
      const matches = directive[2].split('||').some(name => name.trim() === platform)
      active.push(directive[1] === 'ifdef' ? matches : !matches)
    }
    return false
  }).join('\n')
}

async function service(file, names, context, platform = 'MP-WEIXIN') {
  const source = await fs.readFile(new URL(`../services/${file}.js`, import.meta.url), 'utf8')
  const code = platformSource(source, platform).replace(/^import .*$/gm, '').replace(/^export /gm, '')
  const sandbox = { ArrayBuffer, setTimeout, ...context }
  vm.runInNewContext(`${code}\nObject.assign(globalThis, {${names.join(',')}})`, sandbox)
  return sandbox
}

test('微信使用 POST 传输 PATCH，保留 JSON、令牌和部署前缀；H5 仍用 PATCH', async () => {
  for (const platform of ['MP-WEIXIN', 'H5']) {
    let sent
    const api = await service('http', ['request'], {
      appConfig: { apiBaseUrl: 'https://example.edu/hufe', requestTimeout: 1000 },
      getAccessToken: () => 'platform-token',
      uni: { request(options) { sent = options; options.success({ statusCode: 200, data: { code: 0, data: { saved: true } } }) } }
    }, platform)
    assert.equal((await api.request({ path: '/api/v1/me/profile', method: 'PATCH', data: { city: '长沙' } })).saved, true)
    assert.equal(sent.url, 'https://example.edu/hufe/api/v1/me/profile')
    assert.equal(sent.method, platform === 'H5' ? 'PATCH' : 'POST')
    assert.equal(sent.header['X-HTTP-Method-Override'], platform === 'H5' ? undefined : 'PATCH')
    assert.equal(sent.header.authorization, 'Bearer platform-token')
    assert.equal(sent.header['content-type'], 'application/json')
    assert.equal(sent.data.city, '长沙')
    assert.equal(sent.withCredentials, platform === 'H5' ? true : undefined)
  }
})

test('微信仍拒绝缺失 HTTPS 网关，不发出登录凭证', async () => {
  const api = await service('http', ['request'], {
    appConfig: { apiBaseUrl: '', requestTimeout: 1000 }, getAccessToken: () => 'secret',
    uni: { request() { assert.fail('must not send') } }
  })
  await assert.rejects(api.request({ path: '/api/v1/me' }), { code: 'API_BASE_URL_REQUIRED' })
})

test('微信无扩展名图片通过真实格式读取并上传，取消选图不报错', async () => {
  const api = await service('privateMaterials', ['chooseImageFiles'], { uni: {
    chooseMedia(options) { assert.equal(options.mediaType[0], 'image'); options.success({ tempFiles: [{ tempFilePath: 'wxfile://opaque', size: 3 }] }) },
    getImageInfo(options) { options.success({ type: 'png' }) },
    getFileSystemManager() { return { readFile(options) { assert.equal(options.filePath, 'wxfile://opaque'); options.success({ data: 'YWJj' }) } } }
  } })
  const [file] = await api.chooseImageFiles()
  assert.equal(file.mimeType, 'image/png')
  assert.match(file.filename, /\.png$/)
  assert.equal(file.dataBase64, 'YWJj')
  api.uni.chooseMedia = options => options.fail({ errMsg: 'chooseMedia:fail cancel' })
  assert.equal((await api.chooseImageFiles()).length, 0)
})

test('大图片使用文件分片，禁止整图 base64；非图片格式被拒绝', async () => {
  const api = await service('privateMaterials', ['chooseImageFiles'], { uni: {
    chooseMedia(options) { options.success({ tempFiles: [{ tempFilePath: 'wxfile://photo', size: 3 * 1024 * 1024 }] }) },
    getImageInfo(options) { options.success({ type: 'jpeg' }) },
    getFileSystemManager() { assert.fail('must not load the entire image') }
  } })
  const [file] = await api.chooseImageFiles()
  assert.equal(file.fileSource.path, 'wxfile://photo')
  assert.equal(file.dataBase64, undefined)
  api.uni.getImageInfo = options => options.success({ type: 'bmp' })
  await assert.rejects(api.chooseImageFiles(), /仅支持/)
})

async function transferContext(extra = {}) {
  const calls = [], reads = []
  let token = 'original'
  const task = { id: 'upload', name: 'a.pdf', size: 5, conversationId: 'group', parts: 2, chunkSize: 3, status: 'uploading', received: { 0: 'existing-server-sha' } }
  const api = await service('wechatChatFiles', ['uploadWechatChatFile', 'downloadWechatChatFile', 'pickWechatChatFile'], { uni: {
    getFileSystemManager: () => ({ readFile(options) { reads.push([options.position, options.length]); options.success({ data: new ArrayBuffer(options.length) }) } }),
    request(options) { calls.push(options); options.success({ statusCode: 200, data: { code: 0, data: { sha256: 'server-sha' } } }); return { abort() {} } },
    ...extra
  } })
  return { ...api, calls, reads, task, setToken: value => { token = value }, backend: {
    chatApi: async path => path.endsWith('/complete') ? { id: task.id, status: 'ready' } : task,
    chatUrl: path => `https://example.edu${path}`, getAccessToken: () => token
  } }
}

test('微信聊天无浏览器全局也可按片上传，续传重验已收到分片并完成', async () => {
  const api = await transferContext()
  const progress = []
  const result = await api.uploadWechatChatFile({ path: 'wxfile://a', name: 'a.pdf', size: 5 }, 'group', { onProgress: p => progress.push(p.percent), existingId: 'upload' }, api.backend)
  assert.equal(result.status, 'ready')
  assert.deepEqual(api.reads, [[0, 3], [3, 2]])
  assert.equal(api.calls.length, 2)
  assert.equal(api.calls[0].method, 'PUT')
  assert.equal(api.calls[0].header.authorization, 'Bearer original')
  assert.deepEqual(progress, [0, 60, 100])
})

test('微信续传遇内容冲突停止且不完成任务，换号后不发出分片', async () => {
  const conflict = await transferContext({ request(options) { options.success({ statusCode: 409, data: { message: '分片内容不一致' } }) } })
  let completed = false
  const backend = { ...conflict.backend, chatApi: async path => { if (path.endsWith('/complete')) completed = true; return conflict.task } }
  await assert.rejects(conflict.uploadWechatChatFile({ path: 'a', name: 'a.pdf', size: 5 }, 'group', { onProgress() {}, existingId: 'upload' }, backend), /分片内容不一致/)
  assert.equal(completed, false)
  const changed = await transferContext()
  changed.backend.chatApi = async () => { changed.setToken('new-account'); return changed.task }
  await assert.rejects(changed.uploadWechatChatFile({ path: 'a', name: 'a.pdf', size: 5 }, 'group', { onProgress() {} }, changed.backend), /账号已变化/)
  assert.equal(changed.calls.length, 0)
})

test('微信取消上传会中止原生 RequestTask，后续分片不继续发送', async () => {
  const control = await service('chat', ['createChatUploadController'], { appConfig: {} })
  const controller = control.createChatUploadController()
  let started, aborted = 0
  const ready = new Promise(resolve => { started = resolve })
  const api = await transferContext({ request() { started(); return { abort() { aborted++ } } } })
  const upload = api.uploadWechatChatFile({ path: 'a', name: 'a.pdf', size: 5 }, 'group', { onProgress() {}, signal: controller.signal }, api.backend)
  await ready
  controller.abort()
  await assert.rejects(upload, /上传已暂停/)
  assert.equal(aborted, 1)
})

test('微信下载按实际文件名打开文档，失败和不支持的类型可回传页面', async () => {
  let opened
  const api = await transferContext({
    downloadFile(options) { options.success({ statusCode: 200, tempFilePath: 'wxfile://download' }) },
    openDocument(options) { opened = options; options.success() }
  })
  await api.downloadWechatChatFile('https://example.edu/file?ticket=private', '说明.PDF')
  assert.equal(opened.fileType, 'pdf')
  assert.equal(opened.showMenu, true)
  assert.equal(opened.filePath, 'wxfile://download')
  await assert.rejects(api.downloadWechatChatFile('https://example.edu/file', 'archive.zip'), /暂不支持/)
  api.uni.downloadFile = options => options.success({ statusCode: 401 })
  await assert.rejects(api.downloadWechatChatFile('https://example.edu/file', 'a.pdf'), /附件已过期/)
})

test('微信图片再次选择保持续传名称，取消文件选择返回空值', async () => {
  let choice = 0
  const api = await transferContext({
    chooseMedia(options) { options.success({ tempFiles: [{ tempFilePath: `wxfile://random-${choice++}`, size: 20 }] }) },
    getImageInfo(options) { options.success({ type: 'png' }) },
    chooseMessageFile(options) { options.fail({ errMsg: 'chooseMessageFile:fail cancel' }) }
  })
  const first = await api.pickWechatChatFile(true)
  const next = await api.pickWechatChatFile(true)
  assert.notEqual(first.path, next.path)
  assert.equal(first.name, next.name)
  assert.match(first.name, /\.png$/)
  assert.equal(await api.pickWechatChatFile(false), null)
})

test('附件下载期间换号不会打开旧账号的文件', async () => {
  let downloaded, opened = false, token = 'old'
  const api = await transferContext({
    downloadFile(options) { downloaded = options },
    openDocument() { opened = true }
  })
  const downloading = api.downloadWechatChatFile('https://example.edu/file', 'private.pdf', () => token)
  token = 'new'
  downloaded.success({ statusCode: 200, tempFilePath: 'wxfile://private' })
  await assert.rejects(downloading, /账号已变化/)
  assert.equal(opened, false)
})
