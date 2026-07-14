# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- Floating UI such as tooltips, popovers, and menus must not rely on `z-index` to escape an
  ancestor with `overflow: hidden/auto/scroll`. Render the floating layer into `document.body`
  through a Portal, position it from the trigger's viewport rectangle, and update its position on
  captured scroll and window resize events.
- Tests for floating UI inside a scroll container must assert that the layer is mounted outside the
  clipping ancestor, in addition to checking its content and hover/focus interaction.
