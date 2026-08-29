import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { BucketRef, MatchupPlace } from '../../core/models';

const RESULT_DISPLAY_MS = 500;
const EXIT_ANIMATION_MS = 180;

@Component({
  selector: 'app-matchup',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
  templateUrl: './matchup.component.html',
  styleUrl: './matchup.component.scss',
})
export class MatchupComponent implements OnInit {
  private vacationId = '';
  private userId = '';

  readonly sparkleIndices = [0, 1, 2, 3, 4, 5, 6, 7];

  places = signal<[MatchupPlace, MatchupPlace] | null>(null);
  bucket = signal<BucketRef | null>(null);
  loading = signal(true);
  voting = signal(false);
  votedId = signal<string | null>(null);
  exiting = signal(false);
  errorMessage = signal('');
  roundsPlayed = signal(0);

  constructor(private api: ApiService, private route: ActivatedRoute, private router: Router, readonly i18n: I18nService) {}

  ngOnInit(): void {
    this.vacationId = this.route.snapshot.paramMap.get('vacationId')!;
    this.userId = this.route.snapshot.paramMap.get('userId')!;
    this.loadMatchup();
    this.preloadPhotos();
  }

  private preloadPhotos(): void {
    this.api.getVacationPhotoUrls(this.vacationId).subscribe({
      next: ({ photoUrls }) => {
        for (const url of photoUrls) {
          const img = new Image();
          img.src = url;
        }
      },
      error: () => {
        // Non-fatal — duels still work, just without the head start.
      },
    });
  }

  loadMatchup(): void {
    this.loading.set(true);
    this.exiting.set(false);
    this.votedId.set(null);
    this.errorMessage.set('');
    this.api.getMatchup(this.vacationId, this.userId).subscribe({
      next: (res) => {
        this.places.set(res.places);
        this.bucket.set(res.bucket);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        if (this.redirectIfNothingToDuel(err)) return;
        this.errorMessage.set(this.i18n.t('matchup.loadError'));
      },
    });
  }

  // A 409 here means exactly one thing (see matchup.ts): every ready place
  // is currently the only one in its bucket, so there's nothing left to
  // pair up. Not a failure — a real end state, and retrying would just get
  // the same 409 forever, so send them to the ranking results instead.
  private redirectIfNothingToDuel(err: unknown): boolean {
    if ((err as { status?: number })?.status !== 409) return false;
    this.router.navigate(['/vacations', this.vacationId, 'ranking'], {
      queryParams: { userId: this.userId, notice: 'noDuels' },
    });
    return true;
  }

  bucketName(): string {
    const b = this.bucket();
    if (!b) return '';
    return this.i18n.currentLang() === 'de' ? b.nameDe : b.nameEn;
  }

  goToPriorities(): void {
    this.router.navigate(['/vacations', this.vacationId, 'users', this.userId, 'priorities']);
  }

  goToVacationSelect(): void {
    this.router.navigate(['/']);
  }

  choose(winner: MatchupPlace, loser: MatchupPlace): void {
    if (this.voting() || !this.places()) return;
    this.voting.set(true);
    this.votedId.set(winner.id);

    let roundCompleted = false;
    let voteDone = false;
    let minDisplayDone = false;

    const advanceIfReady = () => {
      if (!voteDone || !minDisplayDone) return;
      if (roundCompleted) this.roundsPlayed.update((n) => n + 1);
      this.discardAndLoadNext();
    };

    this.api.vote(this.vacationId, this.userId, winner.id, loser.id).subscribe({
      next: (res) => {
        roundCompleted = res.roundCompleted;
        voteDone = true;
        advanceIfReady();
      },
      error: () => {
        this.voting.set(false);
        this.votedId.set(null);
        this.errorMessage.set(this.i18n.t('matchup.voteError'));
      },
    });

    setTimeout(() => {
      minDisplayDone = true;
      advanceIfReady();
    }, RESULT_DISPLAY_MS);
  }

  private discardAndLoadNext(): void {
    this.exiting.set(true);
    setTimeout(() => {
      this.api.getMatchup(this.vacationId, this.userId).subscribe({
        next: (res) => {
          this.places.set(res.places);
          this.bucket.set(res.bucket);
          this.exiting.set(false);
          this.votedId.set(null);
          this.voting.set(false);
        },
        error: (err) => {
          this.exiting.set(false);
          this.voting.set(false);
          if (this.redirectIfNothingToDuel(err)) return;
          this.errorMessage.set(this.i18n.t('matchup.loadError'));
        },
      });
    }, EXIT_ANIMATION_MS);
  }

  goToRanking(): void {
    this.router.navigate(['/vacations', this.vacationId, 'ranking'], {
      queryParams: { userId: this.userId },
    });
  }
}
