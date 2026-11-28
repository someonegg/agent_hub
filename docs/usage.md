# Usage and configuration

English | [简体中文](usage.zh-CN.md) | [繁體中文](usage.zh-TW.md)

## Start the hub

```sh
agent-hub
```

Open <http://127.0.0.1:4173> or the URL printed by the server. Press `Ctrl-C`
to stop the server. Installation and requirements are in the [README](../README.md#quick-start).

By default, Hub reads Codex (`~/.codex`) and Claude Code (`~/.claude`) sessions,
plus Antigravity CLI (`~/.gemini/antigravity-cli`) when present, and listens only on
this machine. For another device, configure
[remote access](#access-from-other-devices) first. To manage sessions on multiple
machines from one Hub, see [Use multiple nodes](#use-multiple-nodes).

## Read conversations

Choose a project and session in the sidebar. Messages load from the beginning as you scroll, then update
automatically at the end. Toggle **Show archived sessions** in the sidebar to browse read-only archived sessions.
You can bookmark a session URL.

The latest loaded plan opens automatically. Use **Show** and **Hide** to control
individual plans, including opening several at once.

## Create and manage sessions

Click a project's **+**, or the global **+** to select an existing project directory.
Choose **Other directory…** to enter the absolute path of an existing directory on the Hub server.
Choose an [Agent](#multiple-agents) and optional launch settings:

- **Worktree:** start in a separate Git worktree for isolated changes.
- **Permission mode:** **Default** uses native configuration; **Auto** uses native automatic approval; **YOLO** skips approval prompts and also disables the Codex sandbox.

If you close the creation dialog or switch nodes, refresh the session list
before retrying. The server may still create the session.

Open an exited session and click **Resume** when available to continue it. Resume
keeps the original Agent and project association, using an available original
working or project directory. Before resuming a session started elsewhere, make
sure its original process has exited.

Use the **…** menu in the top bar to:

- **Archive session:** stop execution and move the session to the archived list.
- **Delete session:** permanently remove session history after confirmation.
- **Handoff:** transfer pane binding to the active agent session after switching sessions in the same terminal.
- **Exit session:** stop its connected terminal and retain history.

Creating and resuming use tmux. If login or permission confirmation blocks startup,
use **Session information → Tmux access** or the displayed attach command to finish in a terminal.
Do not rename Hub's tmux sessions or change their window/pane structure.
See [tmux requirements](technical-reference.md#tmux-interaction) for details.

## Send prompts and files

A green **Live** badge indicates a connected terminal. Send prompts from the
message input. By default, **Shift+Enter** sends and **Enter** inserts a newline.
Enable **Enter to send** in [Settings](#browser-settings) to reverse this.

Expand **Terminal** to inspect the CLI, and use **Interrupt** in the preview's
top-right corner to stop the current operation.
**Working** and **Idle** reflect terminal output, not task completion.

Sent prompts appear as **Pending** until conversation messages update; pure slash
commands skip this preview. Failed sends retain your draft. Draft text and
attachment selections survive session navigation but reset on page refresh.

If an agent switches sessions in the same terminal after `/clear`, `/resume`, or
running a plan, open the top bar's **…** menu and click **Handoff** on the old
session's connected page. When it shows **Superseded**, follow **Go to bound session**.
Unsent drafts stay on the old page.

### File uploads

Use the attachment button (**Take photo**, **Choose images**, **Choose files**),
paste images, or drop files (multiple files supported; no folders; up to **20 MiB**
each). You can preview or remove attachments before sending, with or without text.

Open **Session information → Upload history** to preview, download, or delete
uploaded files (including unsent uploads).

When sending attachments, Hub prepends their absolute server paths to the prompt
from `uploads/` under the [Hub data root](#configure-the-server), which must be
accessible to the agent. Deleting a session triggers background cleanup; archive
and exit retain uploads. See the [upload reference](technical-reference.md#file-uploads)
or [preview upload history](images/ahub-uploads.png).

## Browser settings

Open **Settings** at the bottom of the sidebar to choose language, theme, the
default Agent for new sessions, Worktree and permission mode defaults, and
**Enter to send**. Changes save automatically in this browser. Permission mode
defaults also apply to resume; launch dialogs allow overrides.

The interface starts in English. Language changes take effect immediately
and do not translate conversation or terminal content.

## Use the CLI

`agent-hub` starts the server; `ahub-cli` manages sessions and published resources.
Use `ahub-cli --help` for available commands. Add `--json` for structured command results.

### Session commands

Start Hub first, then run commands in another terminal:

```sh
ahub-cli project list
ahub-cli agent list
ahub-cli session list --project /path/to/project
ahub-cli session create --project /path/to/project
ahub-cli session send <id> --message "Explain the failing tests"
ahub-cli session inspect <id>
ahub-cli session inspect <id> --follow
```

Pass a Hub ID returned by `list` or `create`. `list` excludes archived sessions
unless `--all` is given; `inspect` paginates with `--after <next-after>`, and
`--follow` keeps observing until `Ctrl+C` (it does not stop when a task finishes).

`create` supports `--agent`, `--cwd` (keeps project association), `--worktree`,
`--task`, and `--permission-mode <default|auto|yolo>` (or `--yolo`). `resume`
retains the original Agent and accepts permission mode flags. Input commands
(`send`, `keys`) require a connected, idle terminal unless `--force` is passed
(which also allows `send` messages starting with `/`). Use `terminal`,
`interrupt`, `handoff`, `exit`, `archive`, and `delete` to inspect and manage
sessions; run `ahub-cli session --help` for all options.

Commands connect to `http://127.0.0.1:4173` by default. Set `AGENT_HUB_URL` or
pass `--url` to change it; in [multi-node setups](#use-multiple-nodes), point to
a Node's origin directly rather than the multi-node Hub. Use `--timeout <seconds>`
to adjust timeouts, and `NODE_EXTRA_CA_CERTS=/absolute/path/to/ca.pem` for a
private CA.

Successful sending does not mean task completion. After a timeout or exit code `2`
(unknown write result), check `list`, `inspect`, or `terminal` before retrying.
Stopping the client does not cancel a submitted operation, and lifecycle commands
(including `delete`) run without a confirmation prompt. See the
[CLI reference](technical-reference.md#session-cli) for result and timeout contracts.

## Publish pages and diffs

Start Hub with `--hosting` to view published resources. Publishing commands read
local files on the Hub machine and work even while the server is stopped.
They print a relative URL and Markdown link; open the URL on your Hub server.

Storage defaults to `~/.agent-hub/hosting`. If using a custom data root, pass the
same `--home-dir /path` to both the commands and server.

### Publish a page

Publish a built directory containing `index.html`:

```sh
ahub-cli page publish ./demo --project /path/to/project --name demo --title "Design comparison"
```

Use relative asset paths. Hosted pages run as trusted code on the same origin as
Hub, so publish only content you trust. Republish with the same project and name
to update in place while keeping the URL (`--name` defaults to the source
directory name; for worktrees, pass the original project to `--project`).

Browse, copy links, or delete pages in **Pages** (`/artifacts`), or via
`ahub-cli page list` / `page delete <id>`. See the
[hosting reference](technical-reference.md#optional-hosting) for details.

### Share a diff

Generate a diff file, then publish it:

```sh
git diff HEAD > /tmp/review.diff
ahub-cli diff publish /tmp/review.diff --title "Review changes"
```

Open the returned `/diffs/<uuid>` URL. Diffs do not expire: manage them with
`ahub-cli diff list` and `ahub-cli diff delete <uuid>`. See the
[diff reference](technical-reference.md#temporary-diffs) and
[desktop](images/ahub-diff.png) / [mobile](images/ahub-diff-mobile.png) previews.

### Publish with an agent

Install the bundled [`ahub-publish` skill](../skills/ahub-publish) and request it
by name. Run `ahub-cli skill path ahub-publish` to locate it.

## Configure the server

Pass options at startup and restart after changing them. Use `agent-hub --help`
for the full list.

| Option                          | Default        | Purpose                                                                |
| ------------------------------- | -------------- | ---------------------------------------------------------------------- |
| `--port <port>`                 | `4173`         | Listen port; `0` selects a free port                                   |
| `--home-dir <path>`             | `~/.agent-hub` | Hub data root                                                          |
| `--hosting`                     | Disabled       | Serve published pages and diffs                                        |
| `--tmux-socket <path>`          | tmux default   | Use a custom tmux socket                                               |
| `--trust-workspace-for-session` | Disabled       | Override Codex and agy workspace trust for each local Create or Resume |

### Multiple agents

You can configure multiple Codex or Claude Code configuration directories, each with a unique nickname.
Each directory contains `sessions/` for Codex or `projects/` for Claude Code. Antigravity CLI (`agy`)
is added automatically when `~/.gemini/antigravity-cli` exists, or explicitly with
`--agy-agent agy` (one only; only Agent Hub-created sessions are shown):

```sh
agent-hub \
  --codex-agent 'work=~/.codex-work' \
  --claude-agent 'claude=~/.claude' \
  --agy-agent agy
```

Repeat or combine these options as needed. Explicit agents replace **all**
defaults; the first is the default for creation.
Use the sidebar Agent filter to narrow sessions. For web creation, an active Agent
filter or valid default Agent preference takes priority over the first Agent.
See [Agent routing](technical-reference.md#agent-identity-and-routing) for exact rules.

Override an agent's executable with `--agent-command 'nickname=executable'`,
for example `--agent-command 'work=/opt/bin/codex'`. See `agent-hub --help` for details.

## Access from other devices

Hub has no application login. Anyone who can access it can read conversations,
send input, and manage sessions. Keep the default `127.0.0.1` listener unless you
configure authenticated, restricted access through a reverse proxy or mutual TLS (mTLS).

For built-in mTLS:

```sh
agent-hub \
  --host 0.0.0.0 \
  --ssl \
  --ssl-cert /path/to/server-fullchain.pem \
  --ssl-key /path/to/server-key.pem \
  --ssl-ca /path/to/client-ca.pem
```

Install a client certificate and private key on each device, and ensure it trusts
the server certificate. Without `--ssl-ca`, HTTPS encrypts traffic but does not
authenticate clients. Restart after replacing certificates or keys.

To let the local CLI connect without a client certificate, also start the server
with `--local-port 4174`, then use:

```sh
ahub-cli session list --url http://127.0.0.1:4174
```

This additional HTTP listener is disabled by default and binds to `127.0.0.1`;
use `--local-host <host>` to change its listen address.
Other local users and processes can access it; do not forward external proxy traffic to it.

## Use multiple nodes

Install the same Agent Hub release on each machine. Start each Node with
`agent-hub --node-only` and enable `--hosting` on Nodes that serve published
content.

In this LAN example, the nodes listen on their respective LAN addresses.

```sh
# Mac
agent-hub --node-only --host 192.168.1.10 --port 4174

# Linux
agent-hub --node-only --host 192.168.1.11 --port 4174
```

Run this on the Hub machine:

```sh
agent-hub --node Mac=http://192.168.1.10:4174 --node Linux=http://192.168.1.11:4174
```

Add one `--node id=origin` per Node in display order. The Hub opens the first
Node. Use the tabs at the top to switch Nodes. Run copied tmux commands on the
selected Node. For `ahub-cli session`, `project`, or `agent` commands, pass a
Node's origin with `--url` or `AGENT_HUB_URL` rather than the multi-node Hub
address.

Replace the example IPs with addresses the Hub can reach.
For HTTPS, see
[Node TLS configuration](technical-reference.md#tls).

## Troubleshooting

- **No sessions:** check that each configured Agent contains `sessions/` (Codex)
  or `projects/` (Claude). Check the server output for unreadable or skipped files.
- **Port in use:** choose another port, such as `agent-hub --port 4180`.
- **Cannot send input:** complete CLI prompts via **Session information → Tmux access**, wait if busy,
  or use **Resume** if available. Archived sessions are read-only; session logs
  alone do not provide a live terminal connection.
- **Create/resume status unclear:** inspect tmux and refresh the session list before
  retrying to avoid duplicates. Closing the page does not stop an operation;
  restarting the server loses its progress tracking.
- **Camera unavailable:** use the file picker instead.
- **Upload interrupted:** check that the session is connected and retry.

For runtime and recovery details, see the [technical reference](technical-reference.md).

## Uninstall

Stop the server, then run:

```sh
npm uninstall -g @someonegg/agent-hub
```

Sessions, worktrees, running tmux sessions,
uploads, and hosted snapshots remain; clean them up separately as needed.
