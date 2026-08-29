import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { CarouselTile, TileCarouselComponent } from '../../shared/tile-carousel/tile-carousel.component';

@Component({
  selector: 'app-user-select',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TileCarouselComponent,
    TranslatePipe,
  ],
  templateUrl: './user-select.component.html',
  styleUrl: './user-select.component.scss',
})
export class UserSelectComponent implements OnInit {
  tiles = signal<CarouselTile[]>([]);
  vacationName = signal('');
  loading = signal(true);
  showAddDialog = signal(false);
  creating = signal(false);
  errorMessage = signal('');

  // Plain (non-signal) fields are safe here: they're only ever mutated from
  // DOM event bindings (ngModel, clicks), which Angular's event-listener
  // machinery already schedules change detection for on its own — signals
  // are only required for state mutated from HTTP/timer callbacks.
  newName = '';

  copied = signal(false);
  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  private vacationId = '';

  constructor(private api: ApiService, private route: ActivatedRoute, private router: Router, readonly i18n: I18nService) {}

  ngOnInit(): void {
    this.vacationId = this.route.snapshot.paramMap.get('vacationId')!;

    this.api.getVacation(this.vacationId).subscribe({
      next: (v) => this.vacationName.set(v.name),
      error: () => this.router.navigate(['/']),
    });

    this.loadUsers();
  }

  loadUsers(): void {
    this.api.listUsers(this.vacationId).subscribe({
      next: (users) => {
        this.tiles.set(users.map((u) => ({ id: u.id, label: u.name })));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Only sent through the priorities screen the first time — once they've
  // saved weights at least once, later re-entries go straight to dueling.
  // They can still get back to priorities anytime via the "tune" icon on
  // the matchup/ranking pages.
  onSelect(userId: string): void {
    this.api.getBucketWeights(this.vacationId, userId).subscribe({
      next: ({ weights }) => {
        const nextStep = weights.length > 0 ? 'play' : 'priorities';
        this.router.navigate(['/vacations', this.vacationId, 'users', userId, nextStep]);
      },
      error: () => {
        this.router.navigate(['/vacations', this.vacationId, 'users', userId, 'priorities']);
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  // The bare vacation URL (no /users) redirects here automatically (see
  // app.routes.ts), and getting into an already-created vacation is already
  // fully gated behind the unlock screen for a password-protected one via
  // the vacation-lock interceptor — so this link alone is the whole invite.
  get shareUrl(): string {
    return `${window.location.origin}/vacations/${this.vacationId}`;
  }

  copyShareLink(): void {
    navigator.clipboard
      .writeText(this.shareUrl)
      .then(() => {
        this.copied.set(true);
        if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
        this.copiedTimeout = setTimeout(() => this.copied.set(false), 2000);
      })
      .catch(() => {
        // Clipboard API can fail (permissions, insecure context) — the
        // input itself is still selectable/copyable by hand as a fallback.
      });
  }

  onAdd(): void {
    this.showAddDialog.set(true);
    this.newName = '';
    this.errorMessage.set('');
  }

  cancelAdd(): void {
    this.showAddDialog.set(false);
  }

  confirmAdd(): void {
    const name = this.newName.trim();
    this.errorMessage.set('');
    if (name.length < 3 || name.length > 100) {
      this.errorMessage.set(this.i18n.t('userSelect.nameLengthError'));
      return;
    }
    this.creating.set(true);
    this.api.createUser(this.vacationId, name).subscribe({
      next: (user) => {
        this.creating.set(false);
        this.showAddDialog.set(false);
        this.onSelect(user.id);
      },
      error: () => {
        this.creating.set(false);
        this.errorMessage.set(this.i18n.t('userSelect.createError'));
      },
    });
  }
}
