Live collaboration is peer-to-peer. It is designed for a quick shared writing session, not for a permanent team workspace.

## Start a session

1. Open **Live** from the toolbar.
2. Enter a name and an optional password.
3. Start the session.
4. Copy the invite link and send it to a collaborator.

The link contains the room ID. If you set a password, the link also carries the key. Treat the link as a secret.

## What collaborators share

- The project file tree
- File names and modes
- Text content
- Cursor presence and peer names

Images and attachments are not synchronized through the live session. Share a project ZIP if collaborators need the image files.

## How it works

Dexter Write uses Yjs for shared state and y-webrtc for the peer connection. When available, the session uses Yjs IndexedDB persistence in the browser. There is no central document database for a live room.

```text
Browser A ── WebRTC ──► Browser B
     │                      │
     └─ Yjs + IndexedDB     └─ Yjs + IndexedDB
```

A signaling service helps peers find each other. Text edits flow directly between peers.

## Passwords and privacy

The room password protects the room key used by the collaboration layer. It is not an account or a server-side access rule.

For sensitive work:

- Use a strong, unique room password.
- Send the invite link over a separate trusted channel.
- Start a new room for a new session.
- Stop sharing when the session ends.

## Editing behavior

While live mode is active, the editor is bound to the shared document. Local autosave and the live document both exist, but the live session is the shared source during the session.

AI and MCP writes still update the local project state. Keep one person responsible for agent-driven edits during a live session to avoid competing changes.

## When to use live collaboration

**Use it for**

- Co-writing a section
- Reviewing a draft together
- Pair editing a resume or paper
- A short working session with a known collaborator

**Do not use it as**

- A permanent shared workspace
- A backup system
- A way to share images
- An access-control boundary for confidential material

## Ending a session

Use **Leave** to disconnect. The local project remains. The room may continue to exist for other peers until they leave.

If you need a durable shared copy, use cloud sync or export a project ZIP instead.
