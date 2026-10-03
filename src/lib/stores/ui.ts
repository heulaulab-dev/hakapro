import { create } from "zustand";

/** Ephemeral shell UI state. URL-worthy state (filters, tabs, ranges) belongs in nuqs, not here. */
type UiState = {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
}));
