# Extend Panel

An Arabic-first, mobile-first control panel for [OpenClaw](https://openclaw.ai).
Ask your agent for a link in chat, open it on your phone, and manage the things
that normally live in `openclaw.json` — agents, models, MCP servers, skills, and
each agent's workspace files.

Built for people who run an agent but do not want to edit config by hand.

## Install on a Hostinger VPS

One line, in either of Hostinger's terminals:

```bash
curl -fsSL https://raw.githubusercontent.com/Khaled-Harthi/extend-panel/main/install.sh | sh
```

Which terminal you use changes one thing:

| Terminal | Where it runs | What it asks you |
| --- | --- | --- |
| **VPS → Browser terminal** | the host (has `docker`) | nothing — it finds the container and the address itself |
| **App → App terminal** | inside the container | pastes your app address once |

The app terminal's prompt reads `root@srv1846913`, which looks like the VPS, but
it is a shell *inside* the container: no docker socket, and nothing in there
knows the public hostname. Traefik routes `<stack>.$TRAEFIK_HOST` and the stack
name lives only in the compose project on the host, so the installer asks for
the address and then proves it by fetching the panel through it.

The gateway takes about 90 seconds to come back. Then message your agent:

```
/extend
```

You get a private link that expires in 15 minutes and works once. Opening it
signs that browser in for 30 days, so bookmark the page — you will not need to
ask for a link again, and it keeps working if WhatsApp goes down or the gateway
restarts.

## Install anywhere else

```bash
openclaw plugins install git:github.com/Khaled-Harthi/extend-panel@v0.1.3 --force
openclaw gateway restart
```

## Configuration

Nothing is required when the gateway is reachable at its own address. Behind a
reverse proxy or tunnel, tell the panel its public address so chat links point
somewhere real:

```bash
openclaw config set plugins.entries.extend-panel.config.panelUrl "https://your-address"
```

| Key              | Default | Meaning                                        |
| ---------------- | ------- | ---------------------------------------------- |
| `panelUrl`       | derived | Public https address of the panel              |
| `linkTtlMinutes` | `15`    | How long a chat link stays valid               |
| `sessionDays`    | `30`    | How long a browser stays signed in             |
| `mountPath`      | `/hooks/extend-panel` | Path the panel is served at        |

### Why the panel lives under `/hooks`

Hostinger's OpenClaw image puts a proxy in front of the gateway that demands a
token login on every path **except** `/hooks/*`, which it forwards untouched so
channel webhooks keep working. Mounting there is what lets a chat link open on a
phone without a second login. The panel's own session cookie is still the gate —
moving the mount does not remove authentication, it only avoids Hostinger's.

## Security

**Read this before you forward a link to anyone.**

The panel is a single-operator admin surface. There are no user accounts: anyone
holding a valid session can edit every agent, read and change MCP server
settings, install skills, and write agent workspace files. That is the same
level of access as the gateway itself.

- Chat links are single-use and short-lived, and only the owner can request one.
- Session cookies are signed with a key derived from your gateway token, so
  **rotating the gateway token signs every browser out.** That is the way to
  revoke access.
- Sessions are stateless, so a gateway restart does not sign anyone out.
- The panel masks secrets it displays, but it does not pretend a URL containing
  a token is safe to share.

Do not hand links to people you would not give your gateway token to. If you
need several people with different permissions, this is the wrong tool.

## Credits

Arabic text is set in [Noto Naskh Arabic](https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic)
(SIL Open Font License 1.1). Markdown editing uses
[EasyMDE](https://github.com/Ionaru/easy-markdown-editor) (MIT).

## License

MIT — see [LICENSE](./LICENSE).
