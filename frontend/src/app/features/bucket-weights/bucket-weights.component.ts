import { Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { Bucket } from '../../core/models';

interface WeightRow {
  bucket: Bucket;
  pct: number;
}

@Component({
  selector: 'app-bucket-weights',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSliderModule, TranslatePipe],
  templateUrl: './bucket-weights.component.html',
  styleUrl: './bucket-weights.component.scss',
})
export class BucketWeightsComponent implements OnInit {
  private vacationId = '';
  private userId = '';

  rows = signal<WeightRow[]>([]);
  uncategorizedCount = signal(0);
  loading = signal(true);
  saving = signal(false);
  errorMessage = signal('');

  retryingUncategorized = signal(false);
  retryMessage = signal('');

  // Highest-priority first, so the live summary doubles as an at-a-glance
  // ranking — the buckets sliding toward the bottom are the ones being
  // deprioritized as you drag another slider up.
  sortedRows = computed<WeightRow[]>(() => [...this.rows()].sort((a, b) => b.pct - a.pct));

  totalPct = computed<number>(() => this.rows().reduce((sum, r) => sum + r.pct, 0));
  canSave = computed<boolean>(() => Math.abs(this.totalPct() - 100) < 0.01);

  // Manual entry (see setPctManually) never rescales other fields, so unlike
  // a slider drag it can leave the set not summing to 100 — this flags which
  // fields to blame. Walked in on-screen card order (not the priority-sorted
  // summary): the first field where the running total tips past 100, and
  // everything after it, are "the last value(s)" that pushed it over — not
  // whichever individual field looks wrong in isolation, since any one of
  // them alone might be perfectly reasonable. Under 100 flags no individual
  // field (nothing is wrong yet, the user just isn't done typing) — Save
  // stays disabled via canSave, with the running total shown instead.
  invalidBucketIds = computed<Set<string>>(() => {
    const rows = this.rows();
    let running = 0;
    let cutoff = -1;
    for (let i = 0; i < rows.length; i++) {
      running += rows[i].pct;
      if (running > 100.01) {
        cutoff = i;
        break;
      }
    }
    return cutoff === -1 ? new Set() : new Set(rows.slice(cutoff).map((r) => r.bucket.id));
  });

  constructor(private api: ApiService, private route: ActivatedRoute, private router: Router, readonly i18n: I18nService) {}

  ngOnInit(): void {
    this.vacationId = this.route.snapshot.paramMap.get('vacationId')!;
    this.userId = this.route.snapshot.paramMap.get('userId')!;
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.getBuckets(this.vacationId).subscribe({
      next: ({ buckets, uncategorizedCount }) => {
        this.uncategorizedCount.set(uncategorizedCount);

        this.api.getBucketWeights(this.vacationId, this.userId).subscribe({
          next: ({ weights }) => {
            const byBucket = new Map(weights.map((w) => [w.bucketId, w.weightPct]));
            const equalShare = 100 / Math.max(1, buckets.length);
            const raw = buckets.map((b) => byBucket.get(b.id) ?? equalShare);

            // Renormalize to sum to exactly 100 across whatever buckets are
            // actually active right now. Covers both a bucket newly added
            // since this user last saved (falls back to equalShare above,
            // then everyone else's raw values get scaled down to make room)
            // and a bucket that's since gone empty (its % would otherwise
            // just be silently missing from this user's remaining sliders).
            const sum = raw.reduce((s, v) => s + v, 0);
            const normalized = sum > 0 ? raw.map((v) => (v / sum) * 100) : buckets.map(() => equalShare);

            this.rows.set(buckets.map((b, i) => ({ bucket: b, pct: normalized[i] })));
            this.loading.set(false);
          },
          error: () => {
            this.loading.set(false);
            this.errorMessage.set(this.i18n.t('bucketWeights.loadError'));
          },
        });
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(this.i18n.t('bucketWeights.loadError'));
      },
    });
  }

  bucketName(b: Bucket): string {
    return this.i18n.currentLang() === 'de' ? b.nameDe : b.nameEn;
  }

  goToVacationSelect(): void {
    this.router.navigate(['/']);
  }

  // Displayed/edited as a whole number — the underlying pct keeps full
  // precision internally (so redistribution stays exact), only rounded for
  // what the slider/text field show.
  displayPct(pct: number): number {
    return Math.round(pct);
  }

  // Full precision (up to 4 decimals, trailing zeros trimmed) for the "must
  // add up to 100%" hint — a slider-set value like 31.1111% rounds to a
  // clean "31" everywhere else, but showing that same rounding in the total
  // hint produces a baffling "currently 100%" when the real sum is off by a
  // slider-dust fraction. This is the one place the hidden precision needs
  // to actually be visible.
  precisePct(n: number): string {
    return parseFloat(n.toFixed(4)).toString();
  }

  // Proportional redistribution: scaling every other slider by the same
  // factor (rather than subtracting a raw delta) always yields non-negative
  // values and an exact sum of 100 without any clamping edge cases.
  adjust(index: number, newValue: number): void {
    const current = this.rows();
    const clamped = Math.max(0, Math.min(100, newValue));
    const others = current.filter((_, i) => i !== index);
    const othersSum = others.reduce((sum, r) => sum + r.pct, 0);
    const remaining = 100 - clamped;

    const updated = current.map((r, i) => {
      if (i === index) return { ...r, pct: clamped };
      if (othersSum <= 0) return { ...r, pct: remaining / Math.max(1, others.length) };
      return { ...r, pct: (r.pct / othersSum) * remaining };
    });
    this.rows.set(updated);
  }

  // Typing a precise value by hand is exactly the case where auto-rescaling
  // the other fields is unwelcome — it would silently change a number the
  // user already deliberately set. This only ever touches its own row;
  // invalidBucketIds/canSave (recomputed reactively from rows()) are what
  // tell the user their total is off and block saving, rather than the
  // component forcing it back to 100 on their behalf.
  //
  // Every OTHER row gets snapped to its currently-displayed whole number at
  // the same time — a slider produces values like 31.1111%, and once the
  // user starts typing exact numbers there's no reason for that invisible
  // fractional dust to keep lingering on fields they haven't touched yet;
  // it would just silently poison the total by whatever the slider left
  // behind. This is idempotent (a field already whole from an earlier
  // manual edit is unaffected), so it's safe to do on every edit, not just
  // the first.
  setPctManually(index: number, newValue: number): void {
    if (!Number.isFinite(newValue)) return;
    const clamped = Math.max(0, Math.min(100, newValue));
    const current = this.rows();
    this.rows.set(
      current.map((r, i) => (i === index ? { ...r, pct: clamped } : { ...r, pct: this.displayPct(r.pct) }))
    );
  }

  // Re-runs classification for the stray places, then reloads the whole
  // screen — freshly-sorted places may now belong in a bucket the sliders
  // don't know about yet, or an existing bucket's example image could
  // change, so a full reload is simpler and safer than patching state in
  // place.
  retryUncategorized(): void {
    if (this.retryingUncategorized()) return;
    this.retryingUncategorized.set(true);
    this.retryMessage.set('');
    this.api.retryUncategorized(this.vacationId).subscribe({
      next: () => {
        this.retryingUncategorized.set(false);
        this.load();
      },
      error: () => {
        this.retryingUncategorized.set(false);
        this.retryMessage.set(this.i18n.t('bucketWeights.retryError'));
      },
    });
  }

  save(): void {
    if (this.saving() || !this.canSave()) return;
    this.saving.set(true);
    this.errorMessage.set('');
    const weights = this.rows().map((r) => ({ bucketId: r.bucket.id, weightPct: r.pct }));
    this.api.setBucketWeights(this.vacationId, this.userId, weights).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/vacations', this.vacationId, 'users', this.userId, 'play']);
      },
      error: () => {
        this.saving.set(false);
        this.errorMessage.set(this.i18n.t('bucketWeights.saveError'));
      },
    });
  }
}
