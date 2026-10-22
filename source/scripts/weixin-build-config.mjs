/** 微信没有浏览器同源地址，发布包必须在编译时确定可访问的 HTTPS 网关。 */
export function assertWeixinApiBaseUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch {
    throw new Error('微信发布构建必须设置 VITE_API_BASE_URL 为正式 HTTPS 网关')
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host) ||
      /(^|\.)(example|invalid|test)$/.test(host) || /(^|\.)example\.(com|org|net)$/.test(host) || host.includes('.example.')) {
    throw new Error('微信发布构建的 VITE_API_BASE_URL 必须是无凭据、无查询参数的正式 HTTPS 网关，不能使用本机或示例地址')
  }
}
