#!/usr/bin/env bash
#
# 启动湖财人 —— 本地开发环境一键启停
#
# 用途：
#   把「本地 MySQL 容器 → 引导开发数据 → 激活本地数据库配置 → 启动 API / 前端 H5 / 管理后台」
#   串成一条命令。每个步骤都幂等，可反复执行；任一步失败都会说明下一步该做什么。
#
# 用法：
#   ./启动湖财人.sh                    启动（等同 start）
#   ./启动湖财人.sh start
#   ./启动湖财人.sh stop [--with-db]   停止三个进程；加 --with-db 时连 MySQL 容器一起停
#   ./启动湖财人.sh status             查看进程 / 容器 / 端口状态
#   ./启动湖财人.sh logs               持续跟踪三个进程日志（Ctrl+C 退出）
#
# 端口：
#   API 端口取自 source/.env 的 HUFE_API_PORT，未声明时用 8787，并导出给所有子进程；
#   前端 H5 固定 5173，管理后台固定 4180。
#
# 依赖：
#   Docker（本地 MySQL 容器）、Node 22+、pnpm、curl。
#   脚本只读取运行状态，不读取也不打印任何数据库凭据。

set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SELF_NAME="$(basename "${BASH_SOURCE[0]}")"
readonly SRC_DIR="$ROOT_DIR/source"
readonly RUNTIME_DIR="$SRC_DIR/.local-runtime"
readonly DB_CONTAINER='hufe-mysql-local'
readonly DB_HOST_PORT=13306
readonly DEV_DATA_FILE="$SRC_DIR/server/data/application-data.json"
readonly DEFAULT_API_PORT=8787
readonly FRONTEND_PORT=5173
readonly ADMIN_PORT=4180

API_PORT=''
DB_LOG_SINCE=''

step() { printf '\n[%s] %s\n' "$1" "$2"; }
note() { printf '      %s\n' "$*"; }

fail() {
  printf '\n[失败] %s\n' "$1" >&2
  if [ -n "${2:-}" ]; then printf '       下一步：%s\n' "$2" >&2; fi
  exit 1
}

usage() {
  printf '启动湖财人 —— 本地开发环境一键启停\n\n'
  printf '用法：\n'
  printf '  %s                       启动（等同 start）\n' "$SELF_NAME"
  printf '  %s start\n' "$SELF_NAME"
  printf '  %s stop [--with-db]      停止三个进程；--with-db 时连 MySQL 容器一起停\n' "$SELF_NAME"
  printf '  %s status                查看进程 / 容器 / 端口状态\n' "$SELF_NAME"
  printf '  %s logs                  持续跟踪三个进程日志（Ctrl+C 退出）\n' "$SELF_NAME"
  printf '\nAPI 端口取自 source/.env 的 HUFE_API_PORT，未声明时用 %s；前端 %s、后台 %s 固定。\n' "$DEFAULT_API_PORT" "$FRONTEND_PORT" "$ADMIN_PORT"
}

trap 'printf "\n[中断] 第 %s 行执行失败。处理完上方提示后重跑本脚本；已启动的服务可用「%s stop」停止。\n" "$LINENO" "$SELF_NAME" >&2' ERR

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "未找到命令「$1」" "$2"
}

port_from_env_file() {
  local file="$SRC_DIR/.env" line value
  if [ ! -f "$file" ]; then
    printf '%s' "$DEFAULT_API_PORT"
    return 0
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in
      HUFE_API_PORT=* | export[[:space:]]HUFE_API_PORT=*) ;;
      *) continue ;;
    esac
    value="${line#*=}"
    value="${value//\"/}"
    value="${value//\'/}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 )); then
      printf '%s' "$value"
    else
      printf '%s' "$DEFAULT_API_PORT"
    fi
    return 0
  done < "$file"
  printf '%s' "$DEFAULT_API_PORT"
}

port_in_use() {
  (
    exec 3<>"/dev/tcp/127.0.0.1/$1"
  ) >/dev/null 2>&1
}

api_health_ok() {
  curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1
}

container_exists() { docker inspect "$DB_CONTAINER" >/dev/null 2>&1; }

container_running() {
  local state
  state="$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)"
  [ "$state" = 'true' ]
}

mysql_accepting() {
  local logs
  docker exec "$DB_CONTAINER" mysqladmin ping >/dev/null 2>&1 && return 0
  if [ -n "$DB_LOG_SINCE" ]; then
    logs="$(docker logs --since "$DB_LOG_SINCE" "$DB_CONTAINER" 2>&1 || true)"
  else
    logs="$(docker logs "$DB_CONTAINER" 2>&1 || true)"
  fi
  case "$logs" in
    *'ready for connections'*) return 0 ;;
  esac
  return 1
}

wait_for_mysql() {
  local deadline=$((SECONDS + 60))
  while ! mysql_accepting; do
    if (( SECONDS >= deadline )); then return 1; fi
    sleep 1
  done
  return 0
}

# 从 create-dev-admin.js 的 JSON 输出解析出「用户名」「口令」两行。
# 这是随机口令唯一一次对外输出，因此只做解析与即时打印，不写入任何文件。
parse_bootstrap_credentials() {
  node -e '
const chunks = []
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { chunks.push(chunk) })
process.stdin.on("end", () => {
  let parsed
  try {
    parsed = JSON.parse(chunks.join(""))
  } catch {
    process.exit(1)
  }
  const username = String(parsed.username || "")
  const password = String(parsed.temporaryPassword || "")
  if (!username || !password) process.exit(1)
  process.stdout.write(username + "\n" + password + "\n")
})
'
}

cmd_start() {
  if [ "$#" -gt 0 ]; then
    fail "start 不接受参数「$1」" "直接运行「$SELF_NAME」或「$SELF_NAME start」。"
  fi
  local bootstrapped=false bootstrap_json bootstrap_credentials bootstrap_username bootstrap_password

  step '1/8' '环境自检'
  require_cmd node '安装 Node 22 或更高版本后重试。'
  require_cmd pnpm '执行 corepack enable pnpm 或 npm i -g pnpm 后重试。'
  require_cmd docker '启动 Docker 服务（systemctl start docker）后重试。'
  require_cmd curl '用系统包管理器安装 curl 后重试。'
  [ -d "$SRC_DIR" ] || fail "未找到源码目录 $SRC_DIR" '确认本脚本与 source/ 同级。'
  note "node $(node -v) / pnpm $(pnpm -v)"
  note "项目根目录 $ROOT_DIR"

  step '2/8' '检查依赖'
  if [ -d "$SRC_DIR/node_modules" ]; then
    note 'source/node_modules 已存在，跳过安装。'
  else
    note '未找到 source/node_modules，开始安装依赖（首次较慢）。'
    pnpm -C "$SRC_DIR" install || fail '依赖安装失败' '手工执行「pnpm -C source install」查看完整报错后重试。'
  fi

  step '3/8' '确认 API 端口'
  API_PORT="$(port_from_env_file)"
  export HUFE_API_PORT="$API_PORT"
  if port_in_use "$API_PORT"; then
    if api_health_ok; then
      note "端口 $API_PORT 已被占用且 /health 有响应；若它属于本项目，稍后启动会跳过重复拉起。"
    else
      fail "端口 $API_PORT 已被其他进程占用，且它不响应本项目 /health。" \
           "在 source/.env 写入 HUFE_API_PORT=<空闲端口> 后重跑；本脚本会把它同步给所有子进程。"
    fi
  else
    note "端口 $API_PORT 空闲（来自 source/.env 或默认值 $DEFAULT_API_PORT）。"
  fi

  step '4/8' '准备本地 MySQL 容器'
  if container_exists; then
    if container_running; then
      note "容器 $DB_CONTAINER 已在运行。"
    else
      note "容器 $DB_CONTAINER 已存在但未运行，正在启动。"
      DB_LOG_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      docker start "$DB_CONTAINER" >/dev/null || fail "启动容器 $DB_CONTAINER 失败" "执行「docker logs --tail 100 $DB_CONTAINER」查看原因。"
    fi
  else
    note "容器 $DB_CONTAINER 不存在，正在创建（凭据只写入 $RUNTIME_DIR/mysql/，权限 0600）。"
    DB_LOG_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    ( cd "$SRC_DIR" && node scripts/mysql-local-provision.mjs ) || fail '创建本地 MySQL 容器失败' "确认 Docker 可用，且 $RUNTIME_DIR/mysql/ 下没有残留配置后重试。"
  fi
  note '等待数据库接受连接（最多 60 秒）……'
  wait_for_mysql || fail 'MySQL 未在 60 秒内就绪' "执行「docker logs --tail 100 $DB_CONTAINER」查看启动日志。"
  note "数据库已就绪：127.0.0.1:$DB_HOST_PORT（库名 hufe_local）。"

  step '5/8' '引导开发数据（仅首次）'
  if [ -f "$DEV_DATA_FILE" ]; then
    note '已有开发数据，跳过引导。'
  else
    note 'JSON 开发库不存在，先建立一个本机演示管理员（这是迁移到 MySQL 的唯一数据来源）。'
    bootstrapped=true
    bootstrap_json="$(
      cd "$SRC_DIR/server" &&
        env -u DATABASE_DRIVER NODE_ENV=development \
          DEV_ADMIN_BOOTSTRAP=create-local-development-admin \
          node src/cli/create-dev-admin.js
    )" || fail '开发演示管理员初始化失败' "确认 $SRC_DIR/server/data/ 存在且当前用户可写（目录权限应为 0700、属主为当前用户），再重跑本脚本。"
    bootstrap_credentials="$(printf '%s' "$bootstrap_json" | parse_bootstrap_credentials)" || fail '初始化命令已写入数据，但输出无法解析' "重跑本脚本会因数据文件已存在而跳过引导；如需重置口令，请在有数据的机器上用后台账号管理处理。"
    { IFS= read -r bootstrap_username; IFS= read -r bootstrap_password; } <<< "$bootstrap_credentials"
    printf '        这是本机演示账号：仅本地开发环境有效，脚本不会把它写入任何文件，请自行保存。\n'
    printf '            用户名：%s\n' "$bootstrap_username"
    printf '            初始口令：%s\n' "$bootstrap_password"
  fi

  step '6/8' '激活本地数据库配置'
  if [ -f "$RUNTIME_DIR/mysql/active.env" ]; then
    note 'active.env 已存在，跳过导入。'
  else
    note '首次运行：执行一次性的 JSON → MySQL 导入（期间会短暂停止本项目 API）。'
    ( cd "$SRC_DIR" && node scripts/mysql-local-switch.mjs --apply ) || fail '本地数据库切换失败' "查看 $RUNTIME_DIR 下的日志与 $RUNTIME_DIR/backups/ 备份后重试。"
  fi

  step '7/8' '启动 API / 前端 / 管理后台'
  pnpm -C "$SRC_DIR" local:start || fail '启动三进程失败' "查看 $RUNTIME_DIR/{api,frontend,admin}.log；端口冲突时可先执行「$SELF_NAME stop」再重试。"

  step '8/8' '健康检查'
  local deadline=$((SECONDS + 60))
  until api_health_ok; do
    if (( SECONDS >= deadline )); then
      fail 'API 未在 60 秒内响应 /health' "查看日志：$RUNTIME_DIR/api.log（可用「$SELF_NAME logs」跟踪）。"
    fi
    sleep 1
  done

  printf '\n启动完成，访问地址：\n'
  printf '    API：      http://127.0.0.1:%s/health\n' "$API_PORT"
  printf '    前端 H5：  http://localhost:%s/\n' "$FRONTEND_PORT"
  printf '    管理后台： http://127.0.0.1:%s/\n' "$ADMIN_PORT"
  printf '\n    实际 API 端口：%s（改端口请在 source/.env 设置 HUFE_API_PORT）\n' "$API_PORT"
  printf '    停止：%s stop      状态：%s status      日志：%s logs\n' "$SELF_NAME" "$SELF_NAME" "$SELF_NAME"
  if $bootstrapped; then
    printf '\n    本机演示账号已在第 5 步打印，仅打印一次，请自行保存。\n'
  fi
}

cmd_stop() {
  local with_db=false
  for arg in "$@"; do
    case "$arg" in
      --with-db) with_db=true ;;
      *) fail "stop 不支持参数「$arg」" "可用：「$SELF_NAME stop」或「$SELF_NAME stop --with-db」。" ;;
    esac
  done

  step '1/2' '停止本地三进程'
  pnpm -C "$SRC_DIR" local:stop || fail '停止失败' "查看 $RUNTIME_DIR/processes.json 与 operation.lock 后重试。"

  step '2/2' '收尾'
  if $with_db; then
    if container_running; then
      docker stop "$DB_CONTAINER" >/dev/null || fail "停止容器 $DB_CONTAINER 失败" "执行「docker ps -a --filter name=$DB_CONTAINER」确认状态。"
      note 'MySQL 容器已停止。'
    else
      note 'MySQL 容器本来就没有在运行。'
    fi
    note '容器数据保留在 docker 卷 hufe-mysql-local-data 中；再次 start 会自动拉起。'
  else
    note 'MySQL 容器保持运行（要一起停请加 --with-db）。'
  fi
}

cmd_status() {
  API_PORT="$(port_from_env_file)"
  export HUFE_API_PORT="$API_PORT"

  step '1/3' '项目进程'
  pnpm -C "$SRC_DIR" local:status || note '进程状态读取失败；若从未启动过，先执行 start。'

  step '2/3' 'MySQL 容器'
  if container_exists; then
    if container_running; then
      note "容器 $DB_CONTAINER：运行中（127.0.0.1:$DB_HOST_PORT）。"
    else
      note "容器 $DB_CONTAINER：已创建但未运行，执行 start 会自动拉起。"
    fi
  else
    note "容器 $DB_CONTAINER：不存在，执行 start 会自动创建。"
  fi
  if [ -f "$RUNTIME_DIR/mysql/active.env" ]; then
    note '本地数据库配置：已激活。'
  else
    note '本地数据库配置：未激活，执行 start 会自动导入。'
  fi

  step '3/3' '端口监听'
  local entry name port
  for entry in "API:$API_PORT" "前端 H5:$FRONTEND_PORT" "管理后台:$ADMIN_PORT"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    if port_in_use "$port"; then
      note "$name：127.0.0.1:$port 监听中。"
    else
      note "$name：127.0.0.1:$port 未监听。"
    fi
  done
}

cmd_logs() {
  if [ "$#" -gt 0 ]; then
    fail "logs 不接受参数「$1」" "直接运行「$SELF_NAME logs」。"
  fi
  local files=() name file
  for name in api frontend admin; do
    file="$RUNTIME_DIR/$name.log"
    if [ -f "$file" ]; then files+=("$file"); fi
  done
  if [ "${#files[@]}" -eq 0 ]; then
    fail "还没有日志文件（$RUNTIME_DIR/{api,frontend,admin}.log）" "先执行「$SELF_NAME start」。"
  fi
  note "跟踪 ${files[*]}（Ctrl+C 退出）"
  exec tail -f "${files[@]}"
}

main() {
  local command='start'
  if [ "$#" -gt 0 ]; then
    command="$1"
    shift
  fi
  case "$command" in
    start) cmd_start "$@" ;;
    stop) cmd_stop "$@" ;;
    status) cmd_status "$@" ;;
    logs) cmd_logs "$@" ;;
    -h | --help | help) usage ;;
    *)
      usage >&2
      fail "未知子命令「$command」" '可用子命令：start、stop、status、logs。'
      ;;
  esac
}

main "$@"
