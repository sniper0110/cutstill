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
| `timeline.cut` | Remove a source-second range. |
| `timeline.keep` | Protect a source window: cuts skip it, rate is 1.0× there. The rest of the source remains (not isolate). |
| `timeline.speed` | Global rate and/or a source-window rate. |
| `timeline.layout` | Canvas: `split` (landscape side-by-side), `stack` (portrait shorts, default 1080×1920), `full`, `crop`. Caller fractions (`split` / `stack`), optional seam `captions` (line and/or `words` karaoke), `bandHeight`, `captionFontSize`, palette (`caption` / `captionBand` / `captionActive` / `divider`). No baked 25/75 or brand colors. Default is full-frame until set. |
| `fal.models` | Wired Fal model ids (Seedance 2.5 t2v / i2v / reference-to-video). |
| `fal.generate` | Submit a Fal job. `sessionId` preferred so the mp4 lands in `sessions/<id>/fal/`. `generate_audio` defaults **false**. Needs **`FAL_KEY`**. No `fal.attach` yet. |
| `fal.status` | Poll `jobId`. On completed, download to disk and return `path`. |

Shorts Vox upper pane: `fal.generate` (Seedance) → poll `fal.status` → later `fal.attach` (not in this slice) → `timeline.layout` stack → `render.still` / `render.window`. Live Fal needs **`FAL_KEY`** in the environment. Cutstill never prints the key. Tests mock HTTP; no live Fal in CI.

Not in this slice: `fal.attach`, empty-pane expand, ffmpeg `comp` engine, `comp.scaffold`, `clip.fetch`. There is no `encode.preview` name.

All tool times are **source seconds**. `render.still` / `render.window` / `render.publish` map through kept ranges + speed. `fileSec` is the output time; identity (`fileSec === tSec`) holds when there are no cuts or speed. Comp windows stay source seconds and still draw when the mapped file time corresponds to that source.

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

npx tsx src/cli/cutstill.ts timeline.cut --json '{"sessionId":"<id>","startSec":1.0,"endSec":2.0}'

npx tsx src/cli/cutstill.ts timeline.keep --json '{"sessionId":"<id>","startSec":1.0,"endSec":2.0}'

npx tsx src/cli/cutstill.ts timeline.speed --json '{"sessionId":"<id>","rate":2}'

npx tsx src/cli/cutstill.ts timeline.layout --json '{"sessionId":"<id>","mode":"split","split":{"talent":0.4,"graphics":0.6,"dividerPx":8},"palette":{"divider":"#222222"}}'

npx tsx src/cli/cutstill.ts timeline.layout --json '{
  "sessionId":"<id>",
  "mode":"stack",
  "stack":{"graphics":0.5,"talent":0.5},
  "bandHeight":120,
  "captionFontSize":48,
  "crop":{"x":0.2,"y":0.1,"width":0.4,"height":0.5},
  "captions":[{
    "text":"one two",
    "startSec":0.3,
    "endSec":2.0,
    "words":[
      {"text":"one","startSec":0.3,"endSec":0.9},
      {"text":"two","startSec":0.9,"endSec":2.0}
    ]
  }],
  "palette":{"captionBand":"#111111","caption":"#ffffff","captionActive":"#ffe566","divider":"#222222"}
}'
```

`mode: "stack"` is the shorts canvas: upper graphics pane, lower talking-head **cover crop**, default **1080×1920**. Caller supplies `stack.graphics` / `stack.talent`. Optional `crop` is applied to the **lower talent pane** (same rect as `mode: "crop"`). `captions` sit on the pane seam (`startSec`/`endSec` are source seconds). Optional `words` on a cue are karaoke: the word covering the current source second uses **`palette.captionActive`**; other words use `palette.caption`. `bandHeight` (default 64) is the opaque mid-band height; `captionFontSize` (default 42) is type size. `divider` draws a seam line between the panes. Then `render.still` / `render.window` / `render.publish` use that canvas. Empty-pane expand is not in this slice.

`timeline.cut` ranges must lie within the source duration (`INVALID_INPUT` if `endSec` is past EOF).

After a cut, `render.still` still takes source `tSec` and returns mapped `fileSec`. Example: cut `1.0–2.0`, then `tSec: 2.5` returns `fileSec` ≈ `1.5`.

## Sandbox

Writable tree for comps is `sessions/<id>/` only. Remotion bundles in-session. Composition code cannot fetch or write outside the session. `staticFile` only names files already in the session. Palette/props are injected; there is no baked theme.

## Transcribe

CI never calls a live STT vendor. Tests use a word-level stub. Live Deepgram runs only when `DEEPGRAM_API_KEY` (or `CUTSTILL_STT_KEY`) is set and network is enabled (`CUTSTILL_SKIP_NETWORK=0`).

## Tests

```
npm test
```

Local stand-in mp4s only (`test/fixtures/standin.mp4`, a few seconds, 640×360). No network in tests.
