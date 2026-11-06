import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { Vacation } from '../../core/models';
import { VacationLockService } from '../../core/vacation-lock.service';
import { CarouselTile, TileCarouselComponent } from '../../shared/tile-carousel/tile-carousel.component';

@Component({
  selector: 'app-vacation-select',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    TileCarouselComponent,
    TranslatePipe,
  ],
  templateUrl: './vacation-select.component.html',
  styleUrl: './vacation-select.component.scss',
})
export class VacationSelectComponent implements OnInit {
  private vacations = signal<Vacation[]>([]);
  loading = signal(true);

  // Recomputes automatically both when the vacation list (re)loads and when
  // the language toggles, since it reads i18n.currentLang() via i18n.t()
  // and formatDate().
  tiles = computed<CarouselTile[]>(() =>
    this.vacations().map((v) => {
      const placesLabel = this.i18n.t(
        v.places_total === 1 ? 'vacationSelect.placesCountOne' : 'vacationSelect.placesCountOther',
        { count: v.places_total }
      );
      const daysLabel = this.i18n.t(
        v.duration_days === 1 ? 'vacationSelect.daysCountOne' : 'vacationSelect.daysCountOther',
        { count: v.duration_days }
      );

      if (v.status === 'creating') {
        return { id: v.id, label: v.name, subLabel: this.i18n.t('vacationSelect.preparing'), locked: v.hasPassword };
      }
      // places_total is meaningless mid-draft (0 until start-ranking
      // recomputes it), so this skips the normal places/days/date line the
      // same way 'creating' does, rather than showing a misleading "0 places".
      if (v.status === 'draft') {
        return { id: v.id, label: v.name, subLabel: this.i18n.t('vacationSelect.planning'), locked: v.hasPassword };
      }

      // Two same-named vacations are only going to become more common —
      // the creation date is always available and disambiguates them
      // without anyone having to type anything extra in. The first user
      // to join is most likely whoever created it; shown in the tooltip
      // rather than the tile itself since it doesn't reliably fit next to
      // the date and place count.
      const dateLabel = this.formatDate(v.created_at);
      const tooltipLines = [v.name, `${daysLabel} · ${dateLabel} · ${placesLabel}`];
      if (v.first_user_name) {
        tooltipLines.push(this.i18n.t('vacationSelect.createdByTooltip', { name: v.first_user_name }));
      }

      return {
        id: v.id,
        label: v.name,
        subLabel: `${daysLabel} · ${placesLabel} · ${dateLabel}`,
        locked: v.hasPassword,
        tooltip: tooltipLines.join('\n'),
      };
    })
  );

  private formatDate(iso: string): string {
    const locale = this.i18n.currentLang() === 'de' ? 'de-DE' : 'en-US';
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
  }

  // Plain field: only ever mutated from a DOM event binding (ngModel).
  deletePassword = '';

  deleteTarget = signal<Vacation | null>(null);
  deleting = signal(false);
  deleteError = signal('');

  constructor(
    private api: ApiService,
    private router: Router,
    private lock: VacationLockService,
    readonly i18n: I18nService
  ) {}

  ngOnInit(): void {
    this.api.listVacations().subscribe({
      next: (vacations) => {
        this.vacations.set(vacations);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Goes straight to the unlock screen for a password-protected vacation
  // without a stored token yet, rather than round-tripping through
  // user-select and getting bounced there anyway once its first (gated)
  // request 401s. A stale/expired token here just means that round-trip
  // still happens as a fallback, which is fine.
  onSelect(vacationId: string): void {
    const vacation = this.vacations().find((v) => v.id === vacationId);
    if (vacation?.hasPassword && !this.lock.hasToken(vacationId)) {
      this.router.navigate(['/vacations', vacationId, 'unlock']);
      return;
    }
    this.router.navigate(['/vacations', vacationId, 'users']);
  }

  onAdd(): void {
    this.router.navigate(['/vacations/new']);
  }

  onDeleteRequested(vacationId: string): void {
    const vacation = this.vacations().find((v) => v.id === vacationId);
    if (!vacation) return;
    this.deleteTarget.set(vacation);
    this.deletePassword = '';
    this.deleteError.set('');
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const vacation = this.deleteTarget();
    if (!vacation || this.deleting()) return;
    // The unlock token isn't good enough here on purpose — deleting
    // requires actually knowing the password, not just having been let in
    // at some point this session. See the backend route for the same note.
    if (vacation.hasPassword && !this.deletePassword) return;

    this.deleting.set(true);
    this.deleteError.set('');
    this.api.deleteVacation(vacation.id, vacation.hasPassword ? this.deletePassword : undefined).subscribe({
      next: () => {
        this.deleting.set(false);
        this.vacations.update((list) => list.filter((v) => v.id !== vacation.id));
        this.deleteTarget.set(null);
      },
      error: (err) => {
        this.deleting.set(false);
        this.deleteError.set(
          err?.status === 401
            ? this.i18n.t('vacationSelect.deleteWrongPassword')
            : this.i18n.t('vacationSelect.deleteError')
        );
      },
    });
  }
}
