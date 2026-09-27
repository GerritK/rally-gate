# Logo

`logo.svg` is the source; `apps/web/public/favicon.svg` and `apps/gate-config/web/public/favicon.svg` are the same paths on a square `#0B0D10` tile. Change all three together.

Rules the geometry follows, so an edit doesn't reintroduce the inconsistencies the first draft had:

- One slant for every forward edge (dx/dy 0.64); the R's leg and the G's bottom-left chamfer share a second one (0.86), so they run parallel.
- One stroke width (72, measured perpendicular to the stroke), bars and slanted stems alike.
- Only the sides where R and G face each other are rounded — outer radius 52, inner 14, true circular arcs. Outer sides and stroke ends stay sharp. No sharp corner directly next to a rounded one.
- The G's top sits on the underside of the R's top bar; both share the baseline. The gap between the letters is constant along the whole seam.
- Colors are the theme's `primary` (`#FF6B00`) and `secondary` (`#00D3F2`) from `packages/ui/src/theme.ts`.
