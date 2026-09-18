/**
 * Global privacy / view-mode store.
 *
 * Controls whether the UI renders confidential fields as plaintext (authorized
 * session) or as ZK-proof compliance badges (public / auditor view).
 *
 * In a production system the "authorized" mode would be gated behind a
 * consortium-issued session credential. Here we demonstrate the *architecture*:
 * the component layer knows how to render both modes, and the toggle shows
 * reviewers that the design accommodates enterprise data-confidentiality
 * requirements without exposing sensitive values by default.
 */

import { create } from 'zustand';

export type ViewMode = 'public' | 'authorized';

interface PrivacyState {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggle: () => void;
}

export const usePrivacy = create<PrivacyState>((set, get) => ({
  viewMode: 'public',
  setViewMode: (mode) => set({ viewMode: mode }),
  toggle: () => set({ viewMode: get().viewMode === 'public' ? 'authorized' : 'public' }),
}));
