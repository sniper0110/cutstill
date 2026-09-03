# Cutstill

Composition sandbox with a fast look. External agents own the brief and the cut. They author a Remotion composition as source, render a cheap still, **see the PNG**, patch, and repeat. Full encode is later.

Catalog: `cutstill.tools.v1`. MCP and CLI `--json` share the same handlers.

## The loop

1. `session.create` a local source (optional brief is stored as copy, never parsed).
2. `comp.upsert` caller TSX into `sessions/<id>/comps/`.
3. `render.still` at a source time. Disk PNG **and** in-band image on MCP so the model sees pixels this turn.
4. Look at the frame. Patch the composition. Still again.
5. `render.window` when you need motion. `render.publish` once for the full cut.

CLI cannot inline pixels; it writes the PNG and prints path + metadata. MCP must return the image.

## Tools

| Tool | What it does |
| --- | --- |
| `session.create` | Session folder `sessions/<id>/` with source pointer, optional brief copy, empty comps, usage. |
| `session.get` | Persisted snapshot. |
| `comp.upsert` | `{ sessionId, id, engine: "remotion", source, window, props? }`. Writes/patches TSX. Remotion only in this slice. |
| `render.still` | Default iteration unit. Source frame at `tSec` plus Remotion comps whose window covers `t`. Returns `{ path, tSec, fileSec, compsActive, width, height }`. |
| `render.window` | Short mp4 of the same stack for `{ startSec, endSec }` (capped at 12s). Writes `sessions/<id>/windows/`. MCP also returns a midpoint PNG in-band. |
| `render.publish` | Full-cut 1080p (or source size if smaller) plus audio when the source has it. Writes `sessions/<id>/publish.mp4` or `outPath`. Poster still; not the iteration default. |
| `media.transcribe` | `{ language, durationSec, words: [{ text, startSec, endSec, confidence? }], utterances? }`. Cached by source hash. Word-level, not a single 0–end blob. |

Not in this slice: ffmpeg `comp` engine, `comp.scaffold`, timeline mutation, `clip.fetch`. There is no `encode.preview` name.

Time mapping is identity until timeline tools exist (`fileSec === tSec`).

## CLI

```
npx tsx src/cli/cutstill.ts schema
npx tsx src/cli/cutstill.ts <tool> --json '{...}'
npx tsx src/cli/cutstill.ts mcp
```

Examples:

```bash
npx tsx src/cli/cutstill.ts session.create --json '{"sourcePath":"./source.mp4"}'

npx tsx src/cli/cutstill.ts comp.upsert --json '{
  "sessionId":"<id>",
  "id":"marker",
  "engine":"remotion",
  "source":"export default function Marker() { return <div style={{position:\\"absolute\\",left:40,top:40,width:120,height:80,background:\\"#ff0033\\"}} />; }",
  "window":{"startSec":0.2,"endSec":2.4},
  "props":{}
}'

npx tsx src/cli/cutstill.ts render.still --json '{"sessionId":"<id>","tSec":0.8}'

npx tsx src/cli/cutstill.ts render.window --json '{"sessionId":"<id>","startSec":0.4,"endSec":2.0}'

npx tsx src/cli/cutstill.ts render.publish --json '{"sessionId":"<id>"}'

npx tsx src/cli/cutstill.ts media.transcribe --json '{"sessionId":"<id>"}'
```

## Sandbox

Writable tree for comps is `sessions/<id>/` only. Remotion bundles in-session. Composition code cannot fetch or write outside the session. `staticFile` only names files already in the session. Palette/props are injected; there is no baked theme.

## Transcribe

CI never calls a live STT vendor. Tests use a word-level stub. Live Deepgram runs only when `DEEPGRAM_API_KEY` (or `CUTSTILL_STT_KEY`) is set and network is enabled (`CUTSTILL_SKIP_NETWORK=0`).

## Tests

```
npm test
```

Local stand-in mp4s only (`test/fixtures/standin.mp4`, a few seconds, 640×360). No network in tests.
