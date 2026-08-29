import { Component, OnDestroy, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { Vacation } from '../../core/models';
import { VacationLockService } from '../../core/vacation-lock.service';

const POLL_INTERVAL_MS = 2000;

@Component({
  selector: 'app-vacation-create',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatCheckboxModule,
    TranslatePipe,
  ],
  templateUrl: './vacation-create.component.html',
  styleUrl: './vacation-create.component.scss',
})
export class VacationCreateComponent implements OnDestroy {
  // Plain (non-signal) fields: only ever mutated from DOM event bindings
  // (ngModel, file input change), which already schedule change detection
  // on their own in zoneless Angular.
  name = '';
  durationDays: number | null = null;
  activeHoursPerDay: number | null = null;
  avgTravelTimeHours = 0.25;
  placesText = '';
  placesFile: File | null = null;
  isPrivate = false;
  password = '';

  // Signals: mutated from HTTP/timer callbacks, which need an explicit
  // reactive write to notify the (zoneless) change detection scheduler.
  submitting = signal(false);
  errorMessage = signal('');
  creatingVacation = signal<Vacation | null>(null);

  // LLM-suggested places for the current title, used as ghost placeholder
  // text only (never pre-filled) so a slow/failed suggestion call can never
  // clobber anything the user already typed.
  placeSuggestions = signal<string[]>([]);
  placesPlaceholder = computed(() => {
    const suggestions = this.placeSuggestions();
    return suggestions.length > 0 ? suggestions.join('\n') : this.i18n.t('vacationCreate.placesPlaceholder');
  });

  private lastSuggestedTitle = '';
  private suggestionRequestId = 0;

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiService,
    private router: Router,
    private lock: VacationLockService,
    readonly i18n: I18nService
  ) {}

  // Fires on the title field's blur — by the time the user has moved on to
  // duration/hours/etc. there's a few seconds of natural gap for a single
  // Ollama call to resolve in the background. Skipped once the user has
  // actually started typing their own places, since the result would never
  // be visible anyway.
  onTitleBlur(): void {
    const title = this.name.trim();
    if (title.length < 3 || title === this.lastSuggestedTitle || this.placesText.trim().length > 0) return;

    this.lastSuggestedTitle = title;
    this.placeSuggestions.set([]);
    const requestId = ++this.suggestionRequestId;

    this.api.suggestPlaces(title).subscribe({
      next: ({ suggestions }) => {
        if (requestId !== this.suggestionRequestId) return; // superseded by a newer title
        this.placeSuggestions.set(suggestions);
      },
      error: () => {
        // Non-fatal — the textarea just keeps showing the generic placeholder.
      },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.placesFile = input.files && input.files.length > 0 ? input.files[0] : null;
  }

  get placeCount(): number {
    if (this.placesFile) return -1; // unknown until parsed server-side
    return this.placesText
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;
  }

  get canSubmit(): boolean {
    return (
      this.name.trim().length > 2 &&
      this.name.trim().length <= 100 &&
      !!this.durationDays &&
      this.durationDays > 0 &&
      !!this.activeHoursPerDay &&
      this.activeHoursPerDay > 0 &&
      this.activeHoursPerDay <= 24 &&
      (this.placesFile !== null || this.placeCount >= 2) &&
      (!this.isPrivate || this.password.trim().length > 0) &&
      !this.submitting()
    );
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.errorMessage.set('');
    this.submitting.set(true);

    const formData = new FormData();
    formData.append('name', this.name.trim());
    formData.append('durationDays', String(this.durationDays));
    formData.append('activeHoursPerDay', String(this.activeHoursPerDay));
    formData.append('avgTravelTimeHours', String(this.avgTravelTimeHours));
    if (this.placesFile) {
      formData.append('placesFile', this.placesFile);
    } else {
      formData.append('placesText', this.placesText);
    }
    if (this.isPrivate && this.password.trim()) {
      formData.append('password', this.password.trim());
    }

    this.api.createVacation(formData).subscribe({
      next: (vacation) => {
        this.creatingVacation.set(vacation);

        // The creator just typed this password in — unlocking them
        // immediately means they aren't asked to re-enter it a moment
        // later once processing finishes and they land on user-select.
        if (this.isPrivate && this.password.trim()) {
          this.api.unlockVacation(vacation.id, this.password.trim()).subscribe({
            next: ({ token }) => this.lock.setToken(vacation.id, token),
            error: () => {}, // non-fatal — they'll just be asked once, same as anyone else
          });
        }

        this.startPolling(vacation.id);
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.error ?? this.i18n.t('vacationCreate.createError'));
      },
    });
  }

  private startPolling(vacationId: string): void {
    this.pollHandle = setInterval(() => {
      this.api.getVacation(vacationId).subscribe({
        next: (vacation) => {
          this.creatingVacation.set(vacation);
          if (vacation.status === 'ready') {
            this.stopPolling();
            this.router.navigate(['/vacations', vacationId, 'users']);
          } else if (vacation.status === 'failed') {
            this.stopPolling();
            this.submitting.set(false);
            this.creatingVacation.set(null);
            this.errorMessage.set(this.i18n.t('vacationCreate.processingFailed'));
          }
        },
      });
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  get progressPercent(): number {
    const vacation = this.creatingVacation();
    if (!vacation || vacation.places_total === 0) return 0;
    return Math.round((vacation.places_processed / vacation.places_total) * 100);
  }

  get etaLabel(): string {
    const eta = this.creatingVacation()?.eta_seconds;
    if (eta == null) return this.i18n.t('vacationCreate.etaEstimating');
    if (eta <= 0) return this.i18n.t('vacationCreate.etaAlmostDone');
    if (eta < 60) return this.i18n.t('vacationCreate.etaSeconds', { seconds: eta });
    const minutes = Math.ceil(eta / 60);
    return this.i18n.t('vacationCreate.etaMinutes', { minutes });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }
}
