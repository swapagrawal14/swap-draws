# AGENTS.md: read this first (for any AI agent or LLM)

SwapDraws is a static, in-browser whiteboard-animation app by **Swapnil Agrawal** (live: https://swap-draws.vercel.app). Videos are described as a **SwapDraws JSON storyboard** and imported into the app.

- **To write a storyboard:** read and follow [`AI-STORYBOARD-PROMPT.md`](AI-STORYBOARD-PROMPT.md). It is the full director system prompt and schema, with its hard rules.
- **To render, add branding, and the full video pipeline** (image-model illustrations, edge-tts voiceover, frame-perfect render, branded intro, captions and end card): see **https://github.com/swapagrawal14/swap-studio** and its `AGENTS.md`.
- **Brand musts:** hot pink `#F0509A` + yellow `#FFD94A`, bold-outline cartoon illustrations from an image model (never hand-coded SVG illustrations), credit "Dr. Swapnil Agrawal" for Edu Made Fun (`@edumadefun`) videos.
- **Changing app code:** it's plain HTML/CSS/JS with no build step (`index.html`, `js/`, `css/`). Keep the JSON import/export format backward compatible, and test in a browser with no console errors.
