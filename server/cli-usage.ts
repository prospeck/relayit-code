export { HEADLESS_VERBS as HEADLESS_VERB_NAMES } from "./headless/args.ts";

export const HEADLESS_USAGE = `Drive a running workspace (scripts, CI, other agents):
  relayit doctor                    check the server answers and an engine is ready
  relayit bots | channels | models  your bots, your rooms, the engines and their models
  relayit run BOT "do this"         give a bot one job and wait until it and every teammate it asked are done
  relayit send BOT "text"           send one message and return at once
  relayit wait BOT                  wait on work already running
  relayit messages BOT              the latest messages of a conversation
  relayit interrupt BOT [--tree]    press Stop (--tree: and every teammate on its job)
  relayit export BOT --out DIR      write a job's transcripts, files and screens to DIR
  relayit events [--job THREAD]     the server's live events as JSON lines
  relayit team apply FILE           make the workspace match a team file (team export writes one)
  relayit engine set claude --key-env ANTHROPIC_API_KEY   give it an engine without a screen
  relayit connect URL --code CODE --out FILE              get a token for a workspace elsewhere
  relayit new-bot | new-channel | set-model | edit | mcp

  Server: --url URL (or RELAYIT_URL), --port N (or OMB_PORT), else this computer's.
  Token: RELAYIT_TOKEN or --token-file FILE. --json prints one JSON document;
  progress goes to stderr (--quiet drops it). relayit help VERB for the details.`;

export const USAGE = `relayit — your team of AI bots, ready in a few steps

  relayit                         set up once, then open your workspace
  relayit setup [--data-dir DIR]
  relayit start [the same options as serve]
  relayit serve [--port 8799] [--data-dir DIR] [--label NAME]
                    [--public-url https://host] [--tailscale | --domain HOST] [--no-pair]
  relayit pair  [--label NAME] [--client] [--phone ios|android]
                    [--public-url https://host]
  relayit sessions [revoke ID]
  relayit status
  relayit access list | add EMAIL [--chat-only] | remove EMAIL
  relayit service install [--domain HOST | --tailscale] [--port N] [--data-dir DIR] | uninstall
                    [--sentinel]   (the health scan below, every two minutes, instead of the server)
  relayit sentinel [--data-dir DIR] [--out DIR] [--once] [--json]   (read-only health scan; see --help)
  relayit browser install [--with-deps] | status

setup   choose AI access and optional phone access; keep existing bots and chats
start   same as relayit: use your saved settings and open the workspace
serve   starts the server without prompts and prints a pairing link + QR code
pair    mints a pairing code against a running server (--client: chat only)
sessions lists paired devices; "sessions revoke ID" signs one out
status  what the server says about itself
access  the local sign-in allow-list: an address or
        @domain; --chat-only gives chat and approvals without settings.
        Takes effect at once, no restart.
service keep the server running across reboots: writes a systemd unit
        (Linux) or a launchd agent (macOS) for the same serve options and
        prints the commands that install it. Install the package
        permanently first (npm install -g relayit).
browser install: the bots' browser engine (agent-browser, pinned) into the
        data dir, and Chrome for Testing into the user's browser cache.
        --with-deps also installs
        the Linux libraries Chrome needs (run as root once). Then run
        browser install as the user running serve, from that user's home.
        status: what the current user and data directory have.
--tailscale  serve over your tailnet: Tailscale terminates HTTPS and the
             link uses this machine's MagicDNS name (needs Tailscale signed in
             and HTTPS certificates enabled for the tailnet)
--domain     serve at https://HOST on your own domain: a pinned Caddy is
             downloaded once and run alongside the server, and gets the
             certificate itself. Point the domain's DNS at this machine and
             open ports 80 and 443.

--no-open   do not open a browser window
--no-pair   skip phone setup and do not print a pairing code
--local     start locally this time, ignoring saved remote-access settings

${HEADLESS_USAGE}

Install once with \`npm install -g relayit\`, then type \`relayit\`.
Or run without a global install: \`npx relayit\`. Node 24+ is required.
`;
