/** 小程序逻辑层不提供 URLSearchParams，用标准编码保留中文、空格和查询边界。 */
export function encodeQuery(values) {
  return Object.entries(values)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')
}
