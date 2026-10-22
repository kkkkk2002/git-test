# 湖财人完整源码交付

本目录包含客户端、管理后台、后端、公共地图与区域数据、品牌原稿、构建脚本及回归测试源码。部署人员优先阅读包根目录的 deployment/正式环境部署说明.md；可直接使用 runtime/ 中已经验收的网页成品，无需在服务器重新构建前端。

## 运行与重新构建

- Node.js 22、与根 pnpm-lock.yaml 匹配的 pnpm 版本及 workspace 安装；首次重新构建需要访问包仓库。未捆绑前端开发 node_modules、Docker 镜像、Node/MySQL 安装器，此包不是完全断网安装介质。
- 在独立开发目录安装：pnpm install --frozen-lockfile。禁止在正在运行的生产目录安装或升级依赖。workspace 中的根锁文件为本次配套依据，不使用旧独立 admin 锁文件。
- H5同源生产构建：VITE_API_BASE_URL='' node scripts/run-uni.mjs build h5。
- 后台构建：在 admin 目录执行 node node_modules/vite/bin/vite.js build；前后台产物各在 dist/build/h5 和 admin/dist。
- 结构检查：node scripts/validate-project.mjs。后端测试：node --test server/test/*.test.js；前端测试：node --test test/*.test.mjs；后台测试：node --test admin/test/*.test.js admin/test/*.test.mjs。
- 微信小程序的环境配置、服务端兼容要求和真机验收步骤见 [微信小程序开发与验收](docs/WECHAT_MINIPROGRAM.md)。
- 真实 MySQL、Docker 或浏览器集成测试必须按脚本明确参数在独立测试环境执行；无参数时的跳过不等于真实集成测试通过。测试夹具中的示例口令不是正式账号，不得用其初始化生产。
- 本机开发：仓库根目录的 `启动湖财人.sh` 一键串起「本地 MySQL 容器 → 引导开发数据 → 启动 API / 前台 H5 / 管理后台」，首次运行会自动建立一个本机演示管理员并迁移到本地 MySQL（演示账号只在 development 环境有效，凭据仅在首次启动时打印一次）。API 端口默认 8787，在该目录的 `.env` 中设置 `HUFE_API_PORT` 可覆盖（`.env` 不入库，一键脚本会读取并导出给子进程）。这些均为本机脚本，不能用于生产账号初始化。

## 数据与边界

本版本使用 MySQL 六命名空间适配层，不执行历史 PostgreSQL 建表设计。旧 server/db SQL 和过时部署说明没有装入本交付源码。实际业务数据、私有上传材料、聊天文件、数据库密码及 DATA_HASH_SECRET 必须按另行交接清单受控迁移。

server/data/ 只含公共 IP 归属数据库；server/src/maps/ 含长沙内置地图、渲染资产与许可；server/src/regions/ 含行政区域和城市中心公共数据。其余 server/data 内容均不包含。

scripts/ 内保留完整构建与测试依赖，但历史 baota / mysql-baota 专站脚本不是通用安装命令，QA / create-dev 脚本不是生产账号初始化方案。包内成品与当前已上线版本一致，原生 App/小程序需另行构建及真机验收。
