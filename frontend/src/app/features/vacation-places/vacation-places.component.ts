import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { Place, Vacation } from '../../core/models';

const PLACES_POLL_MS = 6000;
const PROGRESS_POLL_MS = 2000;
const DEFAULT_ACTIVE_HOURS = 8;
const DEFAULT_TRAVEL_TIME = 0.25;

// The collaborative phase between "vacation created" and "ranking started":
// anyone who's joined can add/rename/delete places and submit their own
// active-hours/travel-time preference (median-combined at start-ranking),
// until someone presses Start Ranking — at which point this same screen
// flips into the (relocated-from-vacation-create) research progress view,
// so it stays correct for any user regardless of who clicked what.
@Component({
  selector: 'app-vacation-places',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './vacation-places.component.html',
  styleUrl: './vacation-places.component.scss',
})
export class VacationPlacesComponent implements OnInit, OnDestroy {
  private vacationId = '';
  private userId = '';

  loading = signal(true);
  vacationName = signal('');
  status = signal<Vacation['status']>('draft');
  vacation = signal<Vacation | null>(null); // populated once we're in 'creating', for the progress view

  places = signal<Place[]>([]);
  addText = '';
  adding = signal(false);
  errorMessage = signal('');

  editingPlaceId = signal<string | null>(null);
  editingName = '';
  savingEdit = signal(false);

  copied = signal(false);
  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  // Same invite link as user-select's — still the whole invite, since the
  // bare vacation URL redirects into user-select regardless of status, and
  // draft-status vacations route straight back to this screen from there.
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

  activeHoursPerDay: number | null = DEFAULT_ACTIVE_HOURS;
  avgTravelTimeHours: number | null = DEFAULT_TRAVEL_TIME;

  showStartDialog = signal(false);
  startingRanking = signal(false);

  // Ghost placeholder only — same non-clobbering pattern as the old
  // vacation-create title-blur suggestions, just fired once here since the
  // vacation's name is now fixed by the time this screen is reached.
  placeSuggestions = signal<string[]>([]);
  addPlaceholder = computed(() => {
    const suggestions = this.placeSuggestions();
    return suggestions.length > 0 ? suggestions.join('\n') : this.i18n.t('vacationPlaces.addPlaceholder');
  });

  get canStartRanking(): boolean {
    return this.places().length >= 2 && !this.startingRanking();
  }

  private placesPollHandle: ReturnType<typeof setInterval> | null = null;
  private progressPollHandle: ReturnType<typeof setInterval> | null = null;
  private focusListener = () => this.refreshPlaces();

  constructor(private api: ApiService, private route: ActivatedRoute, private router: Router, readonly i18n: I18nService) {}

  ngOnInit(): void {
    this.vacationId = this.route.snapshot.paramMap.get('vacationId')!;
    this.userId = this.route.snapshot.paramMap.get('userId')!;

    this.api.getVacation(this.vacationId).subscribe({
      next: (v) => {
        this.vacationName.set(v.name);
        this.vacation.set(v);
        this.enterStatus(v.status);
      },
      error: () => this.router.navigate(['/']),
    });
  }

  ngOnDestroy(): void {
    this.stopPlacesPolling();
    this.stopProgressPolling();
  }

  // Central place both the initial load and every poll response route
  // through — a status flip (e.g. someone else just hit Start Ranking) is
  // handled identically regardless of who/what noticed it.
  private enterStatus(status: Vacation['status']): void {
    const changed = status !== this.status();
    this.status.set(status);

    if (status === 'draft') {
      if (changed || this.loading()) this.loadDraftData();
      this.stopProgressPolling();
      this.startPlacesPolling();
    } else if (status === 'creating') {
      this.stopPlacesPolling();
      this.loading.set(false);
      this.startProgressPolling();
    } else if (status === 'ready') {
      this.stopPlacesPolling();
      this.stopProgressPolling();
      this.goToNextStep();
    } else {
      this.stopPlacesPolling();
      this.stopProgressPolling();
      this.loading.set(false);
    }
  }

  private loadDraftData(): void {
    this.api.listPlaces(this.vacationId).subscribe({
      next: ({ vacationStatus, places }) => {
        this.places.set(places);
        this.loading.set(false);
        if (places.length === 0) this.fetchSuggestions();
        if (vacationStatus !== this.status()) this.enterStatus(vacationStatus);
      },
      error: () => this.loading.set(false),
    });
    this.api.getTripPrefs(this.vacationId, this.userId).subscribe({
      next: ({ prefs }) => {
        if (prefs) {
          this.activeHoursPerDay = prefs.activeHoursPerDay;
          this.avgTravelTimeHours = prefs.avgTravelTimeHours;
        } else {
          // Nobody's submitted yet for this user — quietly seed the default
          // so a user who never touches these fields still contributes a
          // real value to the median instead of nothing at all.
          this.saveTripPrefs();
        }
      },
    });
  }

  private fetchSuggestions(): void {
    const title = this.vacationName();
    if (!title) return;
    this.api.suggestPlaces(title).subscribe({
      next: ({ suggestions }) => this.placeSuggestions.set(suggestions),
      error: () => {},
    });
  }

  private startPlacesPolling(): void {
    if (this.placesPollHandle) return;
    window.addEventListener('focus', this.focusListener);
    this.placesPollHandle = setInterval(() => this.refreshPlaces(), PLACES_POLL_MS);
  }

  private stopPlacesPolling(): void {
    if (this.placesPollHandle) {
      clearInterval(this.placesPollHandle);
      this.placesPollHandle = null;
      window.removeEventListener('focus', this.focusListener);
    }
  }

  // Skips applying the refreshed list while an inline edit is in progress —
  // otherwise someone else's unrelated change could yank the field out from
  // under whatever the user is mid-typing. Status-change detection still
  // runs every poll regardless, so Start Ranking elsewhere is never missed.
  private refreshPlaces(): void {
    if (this.status() !== 'draft') return;
    this.api.listPlaces(this.vacationId).subscribe({
      next: ({ vacationStatus, places }) => {
        if (vacationStatus !== this.status()) {
          this.enterStatus(vacationStatus);
          return;
        }
        if (this.editingPlaceId() === null) this.places.set(places);
      },
    });
  }

  private startProgressPolling(): void {
    if (this.progressPollHandle) return;
    this.progressPollHandle = setInterval(() => {
      this.api.getVacation(this.vacationId).subscribe({
        next: (v) => {
          this.vacation.set(v);
          if (v.status !== this.status()) this.enterStatus(v.status);
        },
      });
    }, PROGRESS_POLL_MS);
  }

  private stopProgressPolling(): void {
    if (this.progressPollHandle) {
      clearInterval(this.progressPollHandle);
      this.progressPollHandle = null;
    }
  }

  // Same "priorities vs play" check user-select's onSelect already does —
  // reused here for the (rare) case someone lands on this URL after ranking
  // has already started elsewhere.
  private goToNextStep(): void {
    this.api.getBucketWeights(this.vacationId, this.userId).subscribe({
      next: ({ weights }) => {
        const step = weights.length > 0 ? 'play' : 'priorities';
        this.router.navigate(['/vacations', this.vacationId, 'users', this.userId, step]);
      },
      error: () => this.router.navigate(['/vacations', this.vacationId, 'users', this.userId, 'priorities']),
    });
  }

  addPlaces(): void {
    const text = this.addText.trim();
    if (!text || this.adding()) return;
    this.adding.set(true);
    this.errorMessage.set('');
    this.api.addPlaces(this.vacationId, text).subscribe({
      next: () => {
        this.adding.set(false);
        this.addText = '';
        this.refreshPlaces();
      },
      error: (err) => {
        this.adding.set(false);
        this.handleMutationError(err);
      },
    });
  }

  startEdit(place: Place): void {
    this.editingPlaceId.set(place.id);
    this.editingName = place.name;
  }

  cancelEdit(): void {
    this.editingPlaceId.set(null);
  }

  saveEdit(place: Place): void {
    const name = this.editingName.trim();
    if (!name || this.savingEdit()) return;
    this.savingEdit.set(true);
    this.api.renamePlace(this.vacationId, place.id, name, place.updatedAt).subscribe({
      next: () => {
        this.savingEdit.set(false);
        this.editingPlaceId.set(null);
        this.refreshPlaces();
      },
      error: (err) => {
        this.savingEdit.set(false);
        this.editingPlaceId.set(null);
        this.handleMutationError(err);
      },
    });
  }

  deletePlace(place: Place): void {
    this.api.deletePlace(this.vacationId, place.id).subscribe({
      next: () => this.refreshPlaces(),
      error: (err) => this.handleMutationError(err),
    });
  }

  private handleMutationError(err: any): void {
    // A 409 here almost always means "someone else changed this since I
    // last saw it" (including ranking having just started) — refresh
    // instead of leaving stale data on screen, and say so plainly.
    if (err?.status === 409) {
      this.errorMessage.set(this.i18n.t('vacationPlaces.conflictError'));
      this.refreshPlaces();
    } else {
      this.errorMessage.set(this.i18n.t('vacationPlaces.mutationError'));
    }
  }

  saveTripPrefs(): void {
    const hours = Number(this.activeHoursPerDay);
    const travel = Number(this.avgTravelTimeHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return;
    if (!Number.isFinite(travel) || travel < 0) return;
    this.api.setTripPrefs(this.vacationId, this.userId, { activeHoursPerDay: hours, avgTravelTimeHours: travel }).subscribe({
      error: () => {}, // non-fatal — worst case this user's preference just isn't counted this round
    });
  }

  openStartDialog(): void {
    if (!this.canStartRanking) return;
    this.showStartDialog.set(true);
  }

  cancelStartDialog(): void {
    this.showStartDialog.set(false);
  }

  confirmStartRanking(): void {
    if (this.startingRanking()) return;
    this.startingRanking.set(true);
    this.api.startRanking(this.vacationId).subscribe({
      next: (v) => {
        this.startingRanking.set(false);
        this.showStartDialog.set(false);
        this.vacation.set(v);
        this.enterStatus(v.status);
      },
      error: () => {
        this.startingRanking.set(false);
        this.showStartDialog.set(false);
        this.errorMessage.set(this.i18n.t('vacationPlaces.startRankingError'));
      },
    });
  }

  goToVacationSelect(): void {
    this.router.navigate(['/']);
  }

  get progressPercent(): number {
    const v = this.vacation();
    if (!v || v.places_total === 0) return 0;
    return Math.round((v.places_processed / v.places_total) * 100);
  }

  get etaLabel(): string {
    const eta = this.vacation()?.eta_seconds;
    if (eta == null) return this.i18n.t('vacationCreate.etaEstimating');
    if (eta <= 0) return this.i18n.t('vacationCreate.etaAlmostDone');
    if (eta < 60) return this.i18n.t('vacationCreate.etaSeconds', { seconds: eta });
    const minutes = Math.ceil(eta / 60);
    return this.i18n.t('vacationCreate.etaMinutes', { minutes });
  }
}
