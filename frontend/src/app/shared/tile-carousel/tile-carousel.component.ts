import { Component, computed, input, output, signal } from '@angular/core';

export interface CarouselTile {
  id: string;
  label: string;
  subLabel?: string;
  locked?: boolean;
  // Optional richer hover text (can be multi-line) — falls back to `label`
  // when omitted. Useful for details that don't fit the compact tile itself.
  tooltip?: string;
}

// Threshold above which the layout switches from a small centered row of
// circles (classic Netflix profile picker) to a dense, left-aligned,
// scrollable grid that can fill the whole viewport.
const DENSE_THRESHOLD = 7;

// How long a touch has to be held before it counts as a long-press (opens
// the same context menu a right-click does) rather than a tap-to-select.
const LONG_PRESS_MS = 500;

// Rough footprint used to keep the context menu on-screen near a click
// close to the right/bottom edge.
const MENU_WIDTH = 160;
const MENU_HEIGHT = 96;

@Component({
  selector: 'app-tile-carousel',
  templateUrl: './tile-carousel.component.html',
  styleUrl: './tile-carousel.component.scss',
})
export class TileCarouselComponent {
  tiles = input<CarouselTile[]>([]);
  addLabel = input('Add new');
  title = input('');
  showBackButton = input(false);
  backLabel = input('Back');
  searchable = input(false);
  searchPlaceholder = input('Search');
  noResultsLabel = input('No matches');
  // Enables right-click / long-press on a tile to open a Select/Delete
  // context menu instead of just selecting on click.
  deletable = input(false);
  selectMenuLabel = input('Select');
  deleteMenuLabel = input('Delete');

  select = output<string>();
  add = output<void>();
  back = output<void>();
  delete = output<string>();

  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // Built and styled entirely by hand rather than via Angular Material's
  // menu — that route fought Material's own theming (CDK overlay, MDC
  // tokens, cascade order) without ever reliably winning across browsers.
  // A plain positioned div has no internals left to fight.
  contextMenu = signal<{ tileId: string; x: number; y: number } | null>(null);

  // Same reasoning for the tooltip: matTooltip only supports fixed
  // positions relative to the element's edge, not "wherever the pointer
  // is" — this tracks the cursor directly via mousemove instead. Offset so
  // the cursor itself isn't hidden underneath it.
  private static readonly TOOLTIP_OFFSET_X = 14;
  private static readonly TOOLTIP_OFFSET_Y = 20;
  hoveredTile = signal<{ label: string; x: number; y: number } | null>(null);

  searchQuery = signal('');

  readonly showSearch = computed(() => this.searchable() && this.tiles().length > 0);

  readonly filteredTiles = computed<CarouselTile[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return this.tiles();
    return this.tiles().filter((t) => t.label.toLowerCase().includes(q));
  });

  // Once filtered down, the layout should feel like the small sparse picker
  // again rather than staying in dense mode just because the unfiltered
  // list was long.
  readonly isDense = computed(() => this.filteredTiles().length > DENSE_THRESHOLD);

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  initialsFor(label: string): string {
    return label
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }

  onTileHover(event: MouseEvent, tile: CarouselTile): void {
    this.hoveredTile.set({
      label: tile.tooltip ?? tile.label,
      x: event.clientX + TileCarouselComponent.TOOLTIP_OFFSET_X,
      y: event.clientY + TileCarouselComponent.TOOLTIP_OFFSET_Y,
    });
  }

  onTileHoverEnd(): void {
    this.hoveredTile.set(null);
  }

  colorFor(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue}, 55%, 55%)`;
  }

  // Set once a long-press actually opens the menu, so the synthetic click
  // most mobile browsers still fire after touchend doesn't also select the
  // tile out from under the menu that just opened.
  private longPressFired = false;

  onTileClick(tileId: string): void {
    if (this.longPressFired) {
      this.longPressFired = false;
      return;
    }
    this.select.emit(tileId);
  }

  onContextMenu(event: MouseEvent, tileId: string): void {
    if (!this.deletable()) return;
    event.preventDefault();
    this.openContextMenu(tileId, event.clientX, event.clientY);
  }

  onTouchStart(event: TouchEvent, tileId: string): void {
    if (!this.deletable()) return;
    this.clearLongPressTimer();
    // Captured now, not when the timer fires — by then the touch may have
    // already ended and event.touches would be empty.
    const touch = event.touches[0];
    const x = touch?.clientX ?? 0;
    const y = touch?.clientY ?? 0;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.longPressFired = true;
      this.openContextMenu(tileId, x, y);
    }, LONG_PRESS_MS);
  }

  // Any movement or early release cancels the long-press, so it doesn't
  // fire alongside (or right after) a normal tap-to-select.
  onTouchEnd(): void {
    this.clearLongPressTimer();
  }

  private openContextMenu(tileId: string, x: number, y: number): void {
    const maxX = Math.max(8, window.innerWidth - MENU_WIDTH - 8);
    const maxY = Math.max(8, window.innerHeight - MENU_HEIGHT - 8);
    this.contextMenu.set({ tileId, x: Math.min(x, maxX), y: Math.min(y, maxY) });
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  selectFromMenu(tileId: string): void {
    this.closeContextMenu();
    this.select.emit(tileId);
  }

  deleteFromMenu(tileId: string): void {
    this.closeContextMenu();
    this.delete.emit(tileId);
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
}
