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
import { BucketRanking, RankingResponse } from '../../core/models';

// Cycled by index in ranking.userWeights — small and fixed rather than
// generated, since a family-trip vacation only ever has a handful of users.
const USER_COLORS = ['#0288d1', '#e91e63', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#c62828'];

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

  // The tooltip is plain CSS-positioned (centered above its icon) by
  // default, which has no idea where the viewport edges are — right next to
  // the page title near the very top, "above" has nowhere to go and gets
  // clipped. Measured here instead of guessed in CSS: visibility:hidden
  // (not display:none) keeps the tooltip in the layout even while closed,
  // so its real rendered size is measurable before it's ever shown, same
  // approach already used for the tile carousel's context menu clamping.
  positionTooltip(event: Event): void {
    const wrapper = event.currentTarget as HTMLElement;
    const tooltip = wrapper.querySelector<HTMLElement>('.budget-tooltip');
    if (!tooltip) return;

    const margin = 8;
    const iconRect = wrapper.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    tooltip.classList.toggle('tooltip-below', iconRect.top - tooltipRect.height - margin < 0);

    const centeredLeft = iconRect.left + iconRect.width / 2 - tooltipRect.width / 2;
    const overflowsLeft = centeredLeft < margin;
    const overflowsRight = centeredLeft + tooltipRect.width > window.innerWidth - margin;
    tooltip.classList.toggle('tooltip-align-left', overflowsLeft && !overflowsRight);
    tooltip.classList.toggle('tooltip-align-right', overflowsRight && !overflowsLeft);
  }

  adjustmentBucketName(adj: { otherBucketNameEn: string; otherBucketNameDe: string }): string {
    return this.i18n.currentLang() === 'de' ? adj.otherBucketNameDe : adj.otherBucketNameEn;
  }

  userColor(userId: string): string {
    const idx = this.ranking()?.userWeights.findIndex((u) => u.userId === userId) ?? -1;
    return USER_COLORS[Math.max(idx, 0) % USER_COLORS.length];
  }

  // Only users who actually weighed in on this specific bucket get a bar —
  // a 0%-wide bar for someone who left it untouched would just be dead
  // vertical space with nothing to show for it.
  bucketWeightBars(bucket: BucketRanking): { userId: string; userName: string; pct: number }[] {
    return (this.ranking()?.userWeights ?? [])
      .map((uw) => ({
        userId: uw.userId,
        userName: uw.userName,
        pct: uw.weights.find((w) => w.bucketId === bucket.bucketId)?.weightPct ?? 0,
      }))
      .filter((w) => w.pct > 0);
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
