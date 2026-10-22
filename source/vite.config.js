import { defineConfig, loadEnv } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { developmentApiProxy } from './config/devProxy.js'
import { assertWeixinApiBaseUrl } from './scripts/weixin-build-config.mjs'

export default defineConfig(({ mode }) => {
  if (process.env.UNI_PLATFORM === 'mp-weixin' && process.env.NODE_ENV === 'production') {
    const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
    assertWeixinApiBaseUrl(env.VITE_API_BASE_URL)
  }
  return {
    plugins: [uni()],
    server: { proxy: developmentApiProxy(process.env) }
  }
})
