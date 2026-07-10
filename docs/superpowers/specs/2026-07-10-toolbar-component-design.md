# Toolbar Component Design

## Overview
Simple toolbar component for the drive page providing file operation buttons and view toggle functionality.

## Component Structure
```
Toolbar
├── toolbar-actions
│   ├── LiquidButton (New Folder)
│   ├── LiquidButton (Upload)
│   └── LiquidButton (Sync)
└── toolbar-controls
    └── button (View Toggle)
```

## Props Interface
```typescript
interface ToolbarProps {
  onNewFolder?: () => void
  onUpload?: () => void
  onSync?: () => void
  syncing?: boolean
}
```

## State Integration
- Uses `useDrive()` hook from `DriveContext`
- Consumes: `state.viewMode`, `setViewMode`
- Action callbacks passed as props (page-specific)

## Visual Design
- **New Folder**: `LiquidButton` with `glass` variant
- **Upload**: `LiquidButton` with `primary` variant  
- **Sync**: `LiquidButton` with `ghost` variant, disabled when syncing
- **View Toggle**: Simple button with active state for grid mode

## CSS Classes
- `.toolbar` - Main container (flex, space-between)
- `.toolbar-actions` - Action buttons container (flex, gap)
- `.toolbar-controls` - View toggle container
- `.toolbar-view-toggle` - View toggle button
- `.toolbar-view-toggle--active` - Active state (grid view)

## Files to Create/Modify
1. Create: `client/src/components/drive/Toolbar.tsx`
2. Modify: `client/src/styles/drive.css` (add toolbar styles)
3. Modify: `client/src/pages/DrivePage.tsx` (import and use Toolbar)
4. Create: `client/src/components/drive/__tests__/Toolbar.test.tsx`

## Constraints
- Use `React.memo` for performance
- Follow existing Liquid Glass design language
- Maintain consistency with existing `DriveToolbar` component styling
