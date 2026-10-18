# ShadowDesk video

The motion intro (about 31 seconds), rendered from code with Remotion and narrated by VoiceStudio's "The Neighbor".
The script is in `../docs/MOTION-SCRIPT.md`.
Colours, fonts (Geist and Geist Mono) and the panel, pill and mark primitives mirror the dashboard (`frontend/app/globals.css`, `frontend/components/hud.tsx`, `frontend/components/shadowdesk-mark.tsx`).

```bash
cd video
npm install
npm run voiceover        # regenerate missing voiceover lines (VoiceStudio must be running)
npm run studio           # preview and scrub in the browser
npm run render           # out/shadowdesk-intro.mp4 (1920x1080)
npm run render:square    # out/shadowdesk-intro-square.mp4 (1080x1080)
npm run render:vertical  # out/shadowdesk-intro-vertical.mp4 (1080x1920)
npm run still            # out/poster.png
```

Edit a line in `voiceover/lines.json`, then `node voiceover/generate.mjs <line-id>` to regenerate just that one.
Scene timing is worked out from the voiceover lengths (`ORDER` at the top of `src/Intro.tsx`): edit a line, regenerate it, and the scenes re-time themselves.

The figures on screen are the LocalNet demo round's (synthetic assets, no real money).
There is no music bed; to add one, drop a licensed track in `public/` and add it as an `<Audio volume={0.15}>` in `src/Intro.tsx`.
