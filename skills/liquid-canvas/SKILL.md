---
name: liquid-canvas
description: >-
  Collaborate with the user on the Liquid Canvas drawing board (MCP App). Use
  whenever the user asks to open the drawing board, draw diagrams/illustrations/UI
  wireframes, inspect what they sketched, or modify existing elements on the canvas.
---

# Liquid Canvas Collaboration Guide

`liquid-canvas` provides a shared vector + freehand drawing canvas rendered in Antigravity's side pane (`aux_pane`) and full-page view (`global`). Both the user and the agent read and edit the **exact same scene**.

## Core Workflow

1. **Open / Show the Board (`open_canvas`)**:
   - Call `open_canvas` to pop open (or bring focus to) the Liquid Canvas side pane.
   - Do not invent a new board unless the user wants a separate board; default opens the active board (`"main"`).
   - Call `open_canvas` once at the start of a drawing session, or again after major updates if the user hasn't opened the pane yet. When the pane is already open, it polls `app_sync` automatically and updates in real time as you call `draw_elements` / `update_elements` / `delete_elements`.

2. **See What the User Drew (`get_canvas`)**:
   - Always call `get_canvas` before modifying an existing drawing or responding to "look at my sketch / 看看我画的".
   - `get_canvas` returns BOTH:
     - Structured element IDs, types, coordinates, colors, layers, and authors (`user` vs `agent`), AND
     - A rendered PNG image of the canvas so you can visually understand freehand strokes, spatial layout, and proportions.

3. **Draw Rich, Clean Visuals (`draw_elements`)**:
   - Use **batch calls**: send all related shapes, connectors, labels, and paths in a single `draw_elements` call instead of one element per turn.
   - Assign readable semantic `id`s (e.g. `api-gateway`, `arrow-auth-db`, `title-banner`) so you can cleanly modify or reposition them later!
   - Aesthetic tips for Liquid Canvas (1200×800 default):
     - Use `"glass": true` on `rect` elements for frosted liquid-glass cards!
     - Use `"fillGradient"` on focal cards/shapes (`{ "angle": 135, "stops": [{"offset": 0, "color": "rgba(56,189,248,0.28)"}, {"offset": 1, "color": "rgba(139,92,246,0.22)"}] }`).
     - Use curved arrows (`cx`, `cy` midpoint control + `endArrow: "arrow"` + optional `label`) for clean flowcharts.
     - Use `type: "path"` with SVG `d` strings for crisp icons, organic curves, and illustrations, or `type: "freehand"` with `brush: "glow"` / `"pen"` for expressive sketches.
     - Leave generous margins (e.g. 60px+ from canvas edges) and align text inside cards cleanly.

4. **Modify Without Clobbering (`update_elements` / `delete_elements`)**:
   - Prefer `update_elements` with `{ id, dx, dy, ...patch }` to move, resize, recolor, restyle, or relabel existing elements while preserving the user's other strokes.
   - Use `manage_layers` if you want to place agent annotations or refined vectors on a separate layer (e.g. `"AI 精修层"`) above the user's `"草图"` layer!
