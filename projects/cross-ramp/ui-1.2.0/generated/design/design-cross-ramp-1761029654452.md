# System Design Document: Cross-Ramp Catalog Page Redesign

## 1. Architecture Overview

The existing codebase follows a modular and component-based architecture, with a clear separation of concerns between the presentation layer (UI) and the underlying data/business logic. The codebase is organized into an "apps" directory, which contains the main application code, and a "packages" directory, which contains shared UI and utility components.

For the catalog page redesign, we will maintain this modular approach and leverage the existing architectural principles to ensure seamless integration with the current codebase.

## 2. Component Structure and Responsibilities

### 2.1. Catalog Page

The `catalog/page.tsx` file is the main entry point for the catalog page. It will be responsible for:

1. Rendering the overall layout of the catalog page, including the header, main content area, and any global UI elements.
2. Integrating the new `TabMenu` component to handle the switching between the "forge" and "transformer" tabs.
3. Passing any necessary data or state to the `TabMenu` component.

### 2.2. Tab Menu Component

The new `TabMenu` component will be responsible for:

1. Rendering the tab menu UI, including the tab buttons and the content area for the selected tab.
2. Handling the tab switching logic, such as updating the active tab and rendering the corresponding content.
3. Applying the consistent background color (bg-gray-200) to the parent container of the tab menu.
4. Exposing any necessary props or callbacks to allow the parent `catalog/page.tsx` component to control the tab menu behavior.

## 3. Data Flow Diagrams

Since this redesign is focused on the UI and does not involve significant changes to the data flow or business logic, the existing data flow diagrams should remain applicable. The new `TabMenu` component will integrate seamlessly with the existing data flow, consuming any necessary data from the parent `catalog/page.tsx` component.

## 4. Technology Stack Choices

The existing technology stack, which includes Next.js, Zustand, and Tailwind CSS, is well-suited for the catalog page redesign. These technologies support a modular and component-based architecture, making it easy to introduce the new `TabMenu` component without significant changes to the overall system.

## 5. API Design

This redesign does not involve any changes to the existing API design, as it is focused on the UI layer.

## 6. Database Schema

This redesign does not involve any changes to the database schema, as it is focused on the UI layer.

## 7. Integration with Existing Codebase

The new `TabMenu` component will be integrated into the existing codebase by following the established architectural patterns and design principles. The component will be placed in the "apps/ramp/components" directory, which aligns with the current file structure.

## Implementation Files

### New Files:
- `apps/ramp/components/TabMenu.tsx` - New tab menu component with bg-gray-200 container
- `apps/ramp/components/TabMenu.module.css` - Styles for tab menu

### Modified Files:
- `apps/ramp/app/catalog/page.tsx` - Integrate new `TabMenu` component
- `apps/ramp/app/catalog/layout.tsx` - Update layout structure to accommodate the new tab menu