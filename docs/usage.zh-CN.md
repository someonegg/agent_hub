# 使用与配置

[English](usage.md) | 简体中文 | [繁體中文](usage.zh-TW.md)

## 启动 Hub

```sh
agent-hub
```

打开 <http://127.0.0.1:4173> 或服务器打印的地址，按 `Ctrl-C` 停止服务器。
安装与运行要求见 [README](../README.zh-CN.md#快速开始)。

默认从 `~/.codex` 读取 Codex 会话、从 `~/.claude` 读取 Claude Code 会话（若存在 `~/.gemini/antigravity-cli`，同时读取 Antigravity CLI 会话），且仅监听本机。
其他设备访问前，请先配置[远程访问](#从其他设备访问)。
要通过同一个 Hub 管理多台机器上的会话，参阅[使用多个节点](#使用多个节点)。

## 阅读会话

在侧边栏选择项目和会话。消息从头开始随滚动加载，到达末尾后自动更新。
点击侧边栏的**显示已归档会话**图标可浏览只读的归档会话。可收藏会话地址。

最新加载的计划自动展开。使用**显示**或**隐藏**控制单个计划，也可同时展开多个计划。

## 创建与管理会话

点击项目旁的 **+**，或全局 **+** 后选择已有项目目录。选择**其他目录…**可输入 Hub 服务器上已存在目录的绝对路径。
选择 [智能体](#多个智能体) 和可选的启动设置：

- **Worktree：**在独立 Git worktree 中启动，隔离代码改动。
- **权限模式：**默认沿用原生配置；Auto 使用原生自动审批；YOLO 跳过审批提示，Codex 还会禁用其沙盒。

关闭创建对话框或切换节点后，请先刷新会话列表再重试。服务器仍可能完成创建。

打开已退出的会话，在可用时点击**恢复**继续。恢复保留原智能体和项目归属，使用可用的原工作目录或项目目录。
恢复从其他位置启动的会话前，请确认原进程已经退出。

通过顶部栏的 **…** 菜单执行：

- **归档会话：**停止运行，将会话移到归档列表。
- **删除会话：**确认后永久删除会话历史。
- **移交绑定：**在同一终端切换会话后，将窗格绑定移交给当前活动会话。
- **退出会话：**停止已连接终端，保留历史。

创建与恢复使用 tmux。启动若被登录或权限确认阻塞，通过 **会话信息 → 连接 tmux** 或显示的连接命令在终端完成操作。
不要重命名 Hub 的 tmux 会话或修改其窗口、窗格结构。详见 [tmux 要求（英文）](technical-reference.md#tmux-interaction)。

## 发送提示与文件

绿色**运行中**标记表示终端已连接。通过输入框发送提示，默认 **Shift+Enter** 发送、**Enter** 换行；
在[设置](#浏览器设置)中开启**按 Enter 发送**可反转。

展开**终端**查看 CLI，点击预览右上角的**中断**按钮可中断当前操作。
**工作中**和**空闲**反映终端输出，不表示任务是否完成。

已发送提示先显示为**等待中**，随后随会话消息更新；纯 slash command 不显示此预览。
发送失败时保留草稿。草稿文字和附件选择在切换会话时保留，刷新页面后重置。

如果智能体通过 `/clear`、`/resume` 或执行计划在同一终端切换会话，在旧会话的已连接页面打开顶部 **…** 菜单并点击**移交绑定**。
显示**已被替代**后点击**前往已绑定会话**。未发送草稿留在旧页面。

### 文件上传

使用附件按钮（**拍照**、**选择图片**、**选择文件**），或直接粘贴图片、拖放文件（支持多文件，不支持文件夹，单个文件最大 **20 MiB**）。
发送前可预览或移除附件，可单独发送或配合文字发送。

打开**会话信息 → 上传记录**可预览、下载或删除已上传文件（包括未发送的上传）。

发送附件时，Hub 会将文件在 [Hub 数据目录](#配置服务器) `uploads/` 下的绝对路径加入提示，智能体必须能访问此目录。
删除会话会触发后台清理，归档与退出保留文件。详见[上传参考（英文）](technical-reference.md#file-uploads)，
或[查看上传记录截图](images/zh-CN/ahub-uploads.png)。

## 浏览器设置

在侧边栏底部打开**设置**，选择语言、主题、新会话默认智能体、Worktree 与权限模式默认值，以及**按 Enter 发送**。
修改自动保存在当前浏览器。权限模式默认值也用于恢复会话，启动对话框可覆盖默认值。

界面初始为英文，切换语言立即生效，不翻译会话或终端原文。

## 使用 CLI

`agent-hub` 启动服务器，`ahub-cli` 管理会话和发布资源。用 `ahub-cli --help` 查看可用命令，添加 `--json` 可获取结构化命令结果。

### 会话命令

先启动 Hub，再从另一终端执行：

```sh
ahub-cli project list
ahub-cli agent list
ahub-cli session list --project /path/to/project
ahub-cli session create --project /path/to/project
ahub-cli session send <id> --message "Explain the failing tests"
ahub-cli session inspect <id>
ahub-cli session inspect <id> --follow
```

传入 `list` 或 `create` 返回的 Hub ID。`list` 默认不含归档会话（加 `--all` 可包含）；
`inspect` 通过 `--after <next-after>` 翻页，`--follow` 持续观察直到 `Ctrl+C`（不会因任务完成自动结束）。

`create` 支持 `--agent`、`--cwd`（保留项目归属）、`--worktree`、`--task` 与 `--permission-mode <default|auto|yolo>`（或 `--yolo`）；
`resume` 保留原智能体并支持权限模式选项。输入命令（`send`、`keys`）默认要求终端已连接且空闲，
加 `--force` 可跳过空闲检查（同时允许 `send` 发送 `/` 开头的消息）。
其他操作包括 `terminal`、`interrupt`、`handoff`、`exit`、`archive`、`delete`；完整选项见 `ahub-cli session --help`。

默认连接 `http://127.0.0.1:4173`。用 `AGENT_HUB_URL` 或 `--url` 修改地址；
在[多节点](#使用多个节点)场景下，应直接指向目标节点地址，而不是多节点 Hub。
用 `--timeout <seconds>` 调整超时；私有 CA 场景请设置 `NODE_EXTRA_CA_CERTS=/absolute/path/to/ca.pem`。

发送成功不表示任务完成。超时或退出码为 `2`（写入结果不明）时，先用 `list`、`inspect` 或 `terminal` 核查再重试。
停止客户端不会取消已提交操作，且生命周期命令（包括 `delete`）不要求二次确认。
结果与超时契约见 [CLI 参考（英文）](technical-reference.md#session-cli)。

## 发布网页与差异

用 `--hosting` 启动 Hub 以查看发布资源。发布命令读取 Hub 所在机器的本地文件，服务器停止时也可执行。
命令输出相对 URL 和 Markdown 链接，请在 Hub 服务器地址下打开。

默认存储在 `~/.agent-hub/hosting`。自定义数据目录时，命令与服务器必须使用相同的 `--home-dir /path`。

### 发布网页

发布已构建、包含 `index.html` 的目录：

```sh
ahub-cli page publish ./demo --project /path/to/project --name demo --title "Design comparison"
```

资源请使用相对路径。托管网页与 Hub 同源、以可信代码执行，只应发布可信内容。
以相同项目和名称再次发布即可原地更新并保留 URL（`--name` 默认取来源目录名；worktree 请将原项目传给 `--project`）。

在**网页**（`/artifacts`）浏览、复制链接或删除网页，也可使用 `ahub-cli page list` / `page delete <id>`。
详见[托管参考（英文）](technical-reference.md#optional-hosting)。

### 分享差异

生成差异文件后发布：

```sh
git diff HEAD > /tmp/review.diff
ahub-cli diff publish /tmp/review.diff --title "Review changes"
```

打开返回的 `/diffs/<uuid>` 地址。差异不会过期，通过 `ahub-cli diff list` 和 `ahub-cli diff delete <uuid>` 管理。
参阅[差异参考（英文）](technical-reference.md#temporary-diffs)及
[桌面](images/zh-CN/ahub-diff.png) / [手机](images/zh-CN/ahub-diff-mobile.png)预览。

### 通过智能体发布

安装附带的 [`ahub-publish` skill](../skills/ahub-publish)，并按名称请求使用。
执行 `ahub-cli skill path ahub-publish` 定位目录。

## 配置服务器

启动时传入选项，修改后重启。完整列表见 `agent-hub --help`。

| 选项                            | 默认值         | 用途                                                      |
| ------------------------------- | -------------- | --------------------------------------------------------- |
| `--port <port>`                 | `4173`         | 监听端口，`0` 自动选择空闲端口                            |
| `--home-dir <path>`             | `~/.agent-hub` | Hub 数据目录，包含 `uploads/`、`hosting/` 和 `worktrees/` |
| `--hosting`                     | 关闭           | 提供已发布网页与差异访问                                  |
| `--tmux-socket <path>`          | tmux 默认值    | 使用自定义 tmux socket                                    |
| `--trust-workspace-for-session` | 关闭           | 为本机每次创建或恢复会话临时覆盖 Codex 和 agy 的目录信任  |

### 多个智能体

可配置多个 Codex 或 Claude Code 配置目录，每个目录使用唯一昵称。
Codex 目录包含 `sessions/`，Claude Code 目录包含 `projects/`。若存在 `~/.gemini/antigravity-cli`，会自动添加 Antigravity CLI（`agy`）；也可用 `--agy-agent agy` 显式配置（仅限一个，且只显示由 Agent Hub 创建的会话）：

```sh
agent-hub \
  --codex-agent 'work=~/.codex-work' \
  --claude-agent 'claude=~/.claude' \
  --agy-agent agy
```

可重复或混合传入这些选项。显式配置会替换**所有默认智能体**，创建默认使用第一项。
通过侧边栏智能体筛选器缩小范围。网页创建时，有效的智能体筛选或默认智能体偏好优先于第一项。
完整规则见 [智能体路由（英文）](technical-reference.md#agent-identity-and-routing)。

使用 `--agent-command '昵称=可执行文件'` 自定义命令，例如 `--agent-command 'work=/opt/bin/codex'`。详情见 `agent-hub --help`。

## 从其他设备访问

Hub 没有应用层登录，任何能访问它的人都能阅读会话、发送输入和管理会话。
请保持默认 `127.0.0.1` 监听，除非通过反向代理或双向 TLS（mTLS）配置了身份认证并限制访问。

使用内置 mTLS：

```sh
agent-hub \
  --host 0.0.0.0 \
  --ssl \
  --ssl-cert /path/to/server-fullchain.pem \
  --ssl-key /path/to/server-key.pem \
  --ssl-ca /path/to/client-ca.pem
```

每台设备需安装客户端证书及私钥，并信任服务器证书。不指定 `--ssl-ca` 时，HTTPS 仅加密流量，不认证客户端。
更换证书或私钥后需重启。

如需本机 CLI 无客户端证书访问，启动服务器时另加 `--local-port 4174`，然后执行：

```sh
ahub-cli session list --url http://127.0.0.1:4174
```

此额外 HTTP 入口默认关闭，绑定 `127.0.0.1`；可用 `--local-host <host>` 修改监听地址。本机其他用户和进程也能访问，请勿将外部代理流量转发到此入口。

## 使用多个节点

在各台机器上安装同一版本，用 `agent-hub --node-only` 启动各节点。
托管发布内容的节点需加上 `--hosting`。

以下内网示例中，两个节点分别监听各自的内网地址。

```sh
# Mac
agent-hub --node-only --host 192.168.1.10 --port 4174

# Linux
agent-hub --node-only --host 192.168.1.11 --port 4174
```

在 Hub 所在的机器上运行：

```sh
agent-hub --node Mac=http://192.168.1.10:4174 --node Linux=http://192.168.1.11:4174
```

按显示顺序为每个节点添加一个 `--node id=origin`。Hub 默认打开第一个节点，使用顶部标签切换节点。
在当前选中的节点上运行复制的 tmux 命令。执行 `ahub-cli session`、`project` 或 `agent` 命令时，
请通过 `--url` 或 `AGENT_HUB_URL` 直接连接目标节点地址，而非多节点 Hub。

请将示例 IP 替换为 Hub 可访问的地址。
如需使用 HTTPS，参阅[节点 TLS 配置（英文）](technical-reference.md#tls)。

## 故障排查

- **没有会话：**检查各智能体是否包含 `sessions/`（Codex）或 `projects/`（Claude）。查看服务器输出中的不可读或跳过文件提示。
- **端口占用：**换用其他端口，例如 `agent-hub --port 4180`。
- **无法发送输入：**通过**会话信息 → 连接 tmux**完成 CLI 提示，正忙时等待，或在可用时使用**恢复**。归档会话只读，仅有日志不代表终端已连接。
- **创建或恢复状态不明：**重试前检查 tmux 并刷新会话列表，避免重复启动。关闭页面不会停止操作，重启服务器会丢失进度追踪。
- **相机不可用：**改用文件选择器。
- **上传中断：**检查会话已连接后重试。

运行与恢复细节见[技术参考（英文）](technical-reference.md)。

## 卸载

停止服务器后执行：

```sh
npm uninstall -g @someonegg/agent-hub
```

会话、worktree、运行中的 tmux 会话、上传文件和托管快照仍会保留，请按需另行清理。
