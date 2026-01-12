"use client";

import { PermissionsContainer } from "./permissions";

/**
 * PermissionsView - Admin Tab Permissions Management
 *
 * Redesigned with three focused sections:
 * 1. Tab Visibility - Global show/hide toggles
 * 2. Role Access - Role cards with edit modal
 * 3. Tab Ordering - Drag-and-drop ordering
 *
 * This component wraps the new PermissionsContainer for backward
 * compatibility with existing admin layout.
 */
export default function PermissionsView() {
  return <PermissionsContainer />;
}
