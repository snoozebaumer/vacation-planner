import { Component, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { RankingResponse } from '../../core/models';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'export';
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

@Component({
  selector: 'app-ranking',
  imports: [DecimalPipe, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatExpansionModule, TranslatePipe],
  templateUrl: './ranking.component.html',
  styleUrl: './ranking.component.scss',
})
export class RankingComponent implements OnInit {
  private vacationId = '';
  userId: string | null = null;

  ranking = signal<RankingResponse | null>(null);
  loading = signal(true);
  errorMessage = signal('');

  exporting = signal(false);
  exportMessage = signal('');

  vetoBusy = signal(false);
  vetoMessage = signal('');

  retryingUncategorized = signal(false);
  retryMessage = signal('');

  notice = signal('');

  constructor(private api: ApiService, private route: ActivatedRoute, private router: Router, readonly i18n: I18nService) {}

  ngOnInit(): void {
    this.vacationId = this.route.snapshot.paramMap.get('vacationId')!;
    this.userId = this.route.snapshot.queryParamMap.get('userId');
    if (this.route.snapshot.queryParamMap.get('notice') === 'noDuels') {
      this.notice.set(this.i18n.t('ranking.noDuelsNotice'));
    }
    this.loadRanking();
  }

  private loadRanking(): void {
    this.api.getRanking(this.vacationId, this.userId).subscribe({
      next: (res) => {
        this.ranking.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(this.i18n.t('ranking.loadError'));
      },
    });
  }

  dismissNotice(): void {
    this.notice.set('');
  }

  keepRanking(): void {
    if (!this.userId) return;
    this.router.navigate(['/vacations', this.vacationId, 'users', this.userId, 'play']);
  }

  adjustPriorities(): void {
    if (!this.userId) return;
    this.router.navigate(['/vacations', this.vacationId, 'users', this.userId, 'priorities']);
  }

  bucketName(b: { nameEn: string; nameDe: string }): string {
    return this.i18n.currentLang() === 'de' ? b.nameDe : b.nameEn;
  }

  adjustmentBucketName(adj: { otherBucketNameEn: string; otherBucketNameDe: string }): string {
    return this.i18n.currentLang() === 'de' ? adj.otherBucketNameDe : adj.otherBucketNameEn;
  }

  // A bucket's adjustments are always all-negative (donor) or all-positive
  // (recipient) — see redistributeSurplus — so the sign of any one entry
  // says which explanatory line to show.
  budgetNoteKey(bucket: { budgetAdjustments: { hours: number }[] }): string {
    return bucket.budgetAdjustments[0]?.hours < 0 ? 'ranking.budgetDonorNote' : 'ranking.budgetRecipientNote';
  }

  retryUncategorized(): void {
    if (this.retryingUncategorized()) return;
    this.retryingUncategorized.set(true);
    this.retryMessage.set('');
    this.api.retryUncategorized(this.vacationId).subscribe({
      next: () => {
        this.retryingUncategorized.set(false);
        this.loadRanking();
      },
      error: () => {
        this.retryingUncategorized.set(false);
        this.retryMessage.set(this.i18n.t('ranking.retryError'));
      },
    });
  }

  veto(placeId: string): void {
    if (!this.userId || this.vetoBusy()) return;
    this.vetoBusy.set(true);
    this.vetoMessage.set('');
    this.api.setVeto(this.vacationId, this.userId, placeId).subscribe({
      next: () => {
        this.vetoBusy.set(false);
        this.loadRanking();
      },
      error: () => {
        this.vetoBusy.set(false);
        this.vetoMessage.set(this.i18n.t('ranking.vetoSetError'));
      },
    });
  }

  unveto(): void {
    if (!this.userId || this.vetoBusy()) return;
    this.vetoBusy.set(true);
    this.vetoMessage.set('');
    this.api.clearVeto(this.vacationId, this.userId).subscribe({
      next: () => {
        this.vetoBusy.set(false);
        this.loadRanking();
      },
      error: () => {
        this.vetoBusy.set(false);
        this.vetoMessage.set(this.i18n.t('ranking.vetoRemoveError'));
      },
    });
  }

  exportMyMaps(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.exportMessage.set('');

    this.api.exportMyMaps(this.vacationId, this.i18n.currentLang()).subscribe({
      next: (res) => {
        this.exporting.set(false);
        if (res.categories.length === 0) {
          this.exportMessage.set(this.i18n.t('ranking.exportNothing'));
          return;
        }
        const slug = slugify(res.vacationName);
        res.categories.forEach((cat, i) => {
          setTimeout(() => downloadCsv(`${slug}-${cat.key.replace(/_/g, '-')}.csv`, cat.csv), i * 200);
        });
        const key = res.categories.length === 1 ? 'ranking.exportSuccessOne' : 'ranking.exportSuccessOther';
        this.exportMessage.set(this.i18n.t(key, { count: res.categories.length }));
      },
      error: () => {
        this.exporting.set(false);
        this.exportMessage.set(this.i18n.t('ranking.exportError'));
      },
    });
  }
}
