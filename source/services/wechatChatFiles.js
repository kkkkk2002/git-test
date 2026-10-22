function pickerFailure(error, resolve, reject) {
  if (/cancel/i.test(error?.errMsg || '')) resolve(null)
  else reject(new Error(error?.errMsg || '无法选择文件'))
}

export function pickWechatChatFile(images) {
  return new Promise((resolve, reject) => {
    const success = async result => {
      const file = result.tempFiles?.[0]
      if (!file) { resolve(null); return }
      const path = file.path || file.tempFilePath
      try {
        let name = file.name || String(path).split('/').pop()
        if (images) {
          const info = await new Promise((ok, fail) => uni.getImageInfo({ src: path, success: ok, fail }))
          /** 再次选择图片时临时路径会变化；稳定名称让服务端能校验原文件续传。 */
          name = `photo-${file.size}.${info.type || 'jpg'}`
        }
        resolve({ path, name, size: Number(file.size) })
      } catch { reject(new Error('无法读取所选图片')) }
    }
    const options = { count: 1, success, fail: error => pickerFailure(error, resolve, reject) }
    if (images) uni.chooseMedia({ ...options, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'] })
    else uni.chooseMessageFile({ ...options, type: 'all' })
  })
}

function readChunk(path, position, length) {
  return new Promise((resolve, reject) => uni.getFileSystemManager().readFile({
    filePath: path, position, length,
    success: result => {
      if (!(result.data instanceof ArrayBuffer) || result.data.byteLength !== length) {
        reject(new Error('文件读取不完整，请重新选择原文件'))
        return
      }
      resolve(result.data)
    },
    fail: () => reject(new Error('无法读取本地文件，请重新选择原文件'))
  }))
}

function putChunk(url, bytes, token, signal) {
  return new Promise((resolve, reject) => {
    let task
    const abort = () => { task?.abort(); reject(new Error('上传已暂停，可重新选择原文件续传')) }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    if (signal?.aborted) { abort(); return }
    task = uni.request({
      url, method: 'PUT', data: bytes, timeout: 120000,
      header: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      success: response => {
        cleanup()
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.code === 0) resolve(response.data.data)
        else reject(Object.assign(new Error(response.data?.message || '分片上传失败'), { statusCode: response.statusCode }))
      },
      fail: () => { cleanup(); reject(new Error('文件上传失败，请检查网络后重试')) }
    })
    signal?.addEventListener('abort', abort)
    if (signal?.aborted) abort()
  })
}

export async function uploadWechatChatFile(file, conversationId, options, api) {
  const { onProgress, signal, existingId } = options
  const { chatApi, chatUrl, getAccessToken } = api
  const token = getAccessToken()
  const same = () => {
    if (signal?.aborted) throw new Error('上传已暂停，可重新选择原文件续传')
    if (token !== getAccessToken()) throw new Error('登录账号已变化，请重新进入对话')
  }
  if (!file.path || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 5 * 1024 ** 3) throw new Error('单文件大小须在1字节至5GB之间')
  same()
  const task = existingId ? await chatApi(`/uploads/${existingId}`, { token }) : await chatApi(`/conversations/${conversationId}/uploads`, { method: 'POST', token, data: { name: file.name, size: file.size } })
  same()
  if (task.name !== file.name || task.size !== file.size || task.conversationId !== conversationId) throw new Error('请选择原文件继续上传')
  onProgress({ id: task.id, percent: 0, name: file.name, size: file.size })
  if (['ready', 'bound'].includes(task.status)) return task
  for (let index = 0; index < task.parts; index++) {
    same()
    const start = index * task.chunkSize
    const bytes = await readChunk(file.path, start, Math.min(task.chunkSize, file.size - start))
    /** 小程序没有 Web Crypto；已收到的分片也重传，由服务端比较 SHA256，拒绝同名异内容的续传。 */
    await retryChunk(() => putChunk(chatUrl(`/api/v1/chat/uploads/${task.id}/chunks/${index}`), bytes, token, signal), same)
    same()
    onProgress({ id: task.id, percent: Math.round(Math.min(file.size, start + bytes.byteLength) / file.size * 100), name: file.name, size: file.size })
  }
  same()
  const result = await chatApi(`/uploads/${task.id}/complete`, { method: 'POST', token })
  same()
  return result
}

async function retryChunk(send, same) {
  for (let attempt = 0; attempt < 3; attempt++) {
    same()
    try { await send(); return } catch (error) {
      same()
      if (attempt === 2 || (error.statusCode && error.statusCode < 500 && error.statusCode !== 429)) throw error
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
}

export async function downloadWechatChatFile(url, name, getAccessToken = () => '') {
  const ownerToken = getAccessToken()
  if (!/^https:\/\//i.test(url)) throw new Error('当前平台尚未配置正式 HTTPS 文件服务')
  const fileType = String(name).split('.').pop().toLowerCase()
  const documents = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf']
  const images = ['jpg', 'jpeg', 'png', 'gif', 'webp']
  if (!documents.includes(fileType) && !images.includes(fileType)) throw new Error('微信暂不支持打开此文件类型，请在浏览器中下载')
  const filePath = await new Promise((resolve, reject) => uni.downloadFile({
    url,
    success: result => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('附件已过期或无权访问，请重新点击下载')),
    fail: () => reject(new Error('附件下载失败，请检查网络后重试'))
  }))
  if (ownerToken !== getAccessToken()) throw new Error('登录账号已变化，请重新进入对话')
  if (images.includes(fileType)) {
    return new Promise((resolve, reject) => uni.previewImage({ urls: [filePath], success: resolve, fail: () => reject(new Error('无法预览图片')) }))
  }
  return new Promise((resolve, reject) => uni.openDocument({
    filePath, fileType, showMenu: true, success: resolve,
    fail: () => reject(new Error('微信无法打开此附件，请在浏览器中下载'))
  }))
}
