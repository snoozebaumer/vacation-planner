import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { VacationLockService } from '../../core/vacation-lock.service';

@Component({
  selector: 'app-vacation-unlock',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, TranslatePipe],
  templateUrl: './vacation-unlock.component.html',
  styleUrl: './vacation-unlock.component.scss',
})
export class VacationUnlockComponent implements OnInit {
  private vacationId = '';
  private returnUrl = '';

  vacationName = signal('');
  password = '';
  submitting = signal(false);
  errorMessage = signal('');

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private lock: VacationLockService,
    readonly i18n: I18nService
  ) {}

  ngOnInit(): void {
    this.vacationId = this.route.snapshot.paramMap.get('vacationId')!;
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || `/vacations/${this.vacationId}/users`;

    this.api.getVacation(this.vacationId).subscribe({
      next: (v) => {
        this.vacationName.set(v.name);
        // Nothing to unlock — send them straight on rather than showing a
        // password screen for a vacation that was never protected.
        if (!v.hasPassword) this.router.navigateByUrl(this.returnUrl);
      },
      error: () => this.router.navigate(['/']),
    });
  }

  submit(): void {
    if (this.submitting() || !this.password) return;
    this.submitting.set(true);
    this.errorMessage.set('');

    this.api.unlockVacation(this.vacationId, this.password).subscribe({
      next: ({ token }) => {
        this.lock.setToken(this.vacationId, token);
        this.submitting.set(false);
        this.router.navigateByUrl(this.returnUrl);
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(
          err?.status === 401 ? this.i18n.t('vacationUnlock.wrongPassword') : this.i18n.t('vacationUnlock.error')
        );
      },
    });
  }
}
