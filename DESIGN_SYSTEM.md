# Design System

Visual language for the Smithey Operations Dashboard. **Follow these patterns exactly** to ensure new UI looks native.

## Color System

All colors are CSS variables in `globals.css`. **Never use hardcoded hex values.**

### Backgrounds (Depth Hierarchy)

| Variable | Value | Tailwind | Use Case |
|----------|-------|----------|----------|
| `--color-bg-primary` | `#0B0E1A` | `bg-bg-primary` | Base page canvas |
| `--color-bg-secondary` | `#12151F` | `bg-bg-secondary` | Cards, panels, modals |
| `--color-bg-tertiary` | `#1A1D2A` | `bg-bg-tertiary` | Hover states, table headers |

### Text (Information Hierarchy)

| Variable | Value | Tailwind | Use Case |
|----------|-------|----------|----------|
| `--color-text-primary` | `#FFFFFF` | `text-text-primary` | Headlines, key metrics |
| `--color-text-secondary` | `#94A3B8` | `text-text-secondary` | Labels, descriptions |
| `--color-text-tertiary` | `#64748B` | `text-text-tertiary` | De-emphasized content |
| `--color-text-muted` | `#475569` | `text-text-muted` | Decorative text |

### Status Colors (ONLY for Status)

| Variable | Tailwind | When to Use |
|----------|----------|-------------|
| `--color-status-good` | `text-status-good` | On-track, healthy, success |
| `--color-status-warning` | `text-status-warning` | Needs attention |
| `--color-status-bad` | `text-status-bad` | Problem, urgent |

**Important**: Don't use green just because you want something to "pop." Status colors are for status only.

### Accent & Borders

| Variable | Tailwind | Use Case |
|----------|----------|----------|
| `--color-accent-blue` | `text-accent-blue` | Links, active states, primary data |
| `--color-border` | `border-border` | Standard borders (6% white) |
| `--color-border-subtle` | `border-border-subtle` | Row dividers (3% white) |

**Tip**: Use `/30` opacity for softer borders: `border-border/30`

---

## Typography

### Custom Utility Classes

```jsx
<span className="text-metric">1,234</span>     // 42px hero numbers
<span className="text-label">LABEL</span>      // 11px uppercase
<span className="text-context">Details</span>  // 13px body
```

### Standard Sizes

| Class | Size | Use Case |
|-------|------|----------|
| `text-4xl` | 36px | Hero metrics |
| `text-2xl` | 24px | Card values |
| `text-lg` | 18px | Section headers |
| `text-sm` | 14px | Body, table content |
| `text-xs` | 12px | Labels, help text |

### Weights

- `font-bold` — Metric values
- `font-semibold` — Section headers
- `font-medium` — Labels, buttons
- `font-normal` — Body text

---

## Spacing

### Card Padding

| Context | Class |
|---------|-------|
| Standard | `p-5` |
| Compact | `p-4` |
| Spacious | `p-6` |

### Gaps

| Context | Class |
|---------|-------|
| Tight | `gap-2` |
| Standard | `gap-3` or `gap-4` |
| Spacious | `gap-6` |

---

## Component Patterns

### Card

```jsx
<div className="bg-bg-secondary rounded-xl border border-border/30 p-5 transition-all hover:border-border-hover">
  <h3 className="text-label font-medium text-text-tertiary mb-4">
    CARD TITLE
  </h3>
  {/* content */}
</div>
```

### Metric Display

```jsx
<div>
  <div className="text-4xl font-bold tabular-nums text-text-primary">
    {formatNumber(value)}
  </div>
  <div className="text-xs text-text-muted mt-1">METRIC LABEL</div>
</div>
```

### Buttons

```jsx
// Primary
<button className="px-3 py-1.5 rounded-md text-sm font-medium bg-accent-blue text-white hover:bg-accent-blue/90 transition-colors">
  Primary
</button>

// Secondary
<button className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors">
  Secondary
</button>

// Filter pill
<button className={`px-2.5 py-1 text-xs font-medium rounded transition-all ${
  isActive ? "bg-accent-blue text-white" : "text-text-tertiary hover:text-text-secondary hover:bg-white/5"
}`}>
  Filter
</button>
```

### Sub-Tabs (Underline Style)

```jsx
<div className="flex gap-4 border-b border-border/30 pb-2">
  {tabs.map((tab) => (
    <Link
      key={tab.name}
      href={tab.href}
      className={`text-sm font-medium pb-2 border-b-2 -mb-[10px] ${
        isActive
          ? "text-text-primary border-accent-blue"
          : "text-text-muted hover:text-text-secondary border-transparent"
      }`}
    >
      {tab.name}
    </Link>
  ))}
</div>
```

### Table

```jsx
<div className="max-h-[400px] overflow-y-auto scrollbar-thin">
  <table className="w-full">
    <thead className="sticky top-0 bg-bg-tertiary/95 backdrop-blur-sm z-10">
      <tr className="border-b border-border/20">
        <th className="py-2 px-4 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Column
        </th>
      </tr>
    </thead>
    <tbody>
      <tr className="border-b border-border-subtle hover:bg-white/[0.02] transition-colors">
        <td className="py-2.5 px-4 text-sm text-text-primary">Content</td>
      </tr>
    </tbody>
  </table>
</div>
```

### Status Indicators

```jsx
// Text
<span className="text-status-good">On track</span>
<span className="text-status-warning">Attention</span>
<span className="text-status-bad">Critical</span>

// Badge
<span className="px-2 py-0.5 text-xs font-medium rounded bg-status-good/20 text-status-good">
  GOOD
</span>

// Pulsing
<span className="animate-soft-pulse text-status-warning">Urgent</span>
```

### Empty State

```jsx
<div className="flex flex-col items-center justify-center py-8 text-text-muted">
  <IconComponent className="w-8 h-8 mx-auto mb-2 opacity-40" />
  <span className="text-sm">No items found</span>
</div>
```

---

## Border Radius

| Use Case | Class |
|----------|-------|
| Cards, modals | `rounded-xl` |
| Buttons, inputs | `rounded-md` |
| Badges | `rounded-full` |

---

## Animations

From `globals.css`:
- `.animate-soft-pulse` — Urgent items
- `.animate-peck` — Quail pecking
- `.animate-idle-sway` — Idle movement
- `.scrollbar-thin` — Subtle ember-tinted scrollbar

---

## Whimsy Rules

Subtle brand personality is allowed in:
- Loading states ("Seasoning the data...")
- Empty states
- Success moments (bouncing quail)

**Never in**: metrics, charts, tables, or anywhere that adds friction.

Cast iron themes: forge, seasoning, tempering, polishing, heating.

---

## Exception: ProductionPlanningDashboard

This dashboard intentionally uses different styling (GitHub dark theme, spreadsheet aesthetic). Don't copy its patterns for new dashboards.

---

## Checklist

Before shipping:
- [ ] CSS variables, not hardcoded hex
- [ ] Cards: `bg-bg-secondary rounded-xl border border-border/30 p-5`
- [ ] Tables: sticky headers + `scrollbar-thin`
- [ ] Status colors only for status
- [ ] Empty states have centered icon + message
